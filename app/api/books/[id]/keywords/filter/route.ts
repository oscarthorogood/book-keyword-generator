import { applyAiRelevance, isAiRankingConfigured, rankKeywordsWithAi } from "@/lib/aiRanker";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { mapWithConcurrency } from "@/lib/concurrency";
import { capAndRank } from "@/lib/keywordCapAndRank";
import { buildFilterContext, filterKeywords, type FilterableKeyword } from "@/lib/keywordFilters";
import { BOOK_COMP_NAME_MAX, BOOK_KEYWORD_MAX } from "@/lib/keywordMerge";
import { genreFamilySearchTerms } from "@/lib/genre";
import { scoreSpecificity } from "@/lib/keywordSpecificity";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { KeywordCandidate, KeywordCategory, KeywordSource, MatchType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Statuses the pipeline is allowed to change. A negative keyword is a human decision. */
const REFILTERABLE_STATUSES = ["active", "paused", "rejected", "archived"];

/**
 * How many keywords per bucket the AI relevance re-filter judges at once.
 * Mirrors the cap in keywords/generate/route.ts — the AI sees a shortlist,
 * not the full set, to keep the call small and cheap.
 */
const AI_REVIEW_LIMIT = 80;

interface KeywordRow {
  id: string;
  text: string;
  source: string | null;
  status: string;
  match_type: MatchType;
  bid: number | null;
  category: string | null;
  specificity: number | null;
}

/**
 * POST /api/books/[id]/keywords/filter
 * Body: { dryRun?: boolean }
 *
 * Runs the drop-rule filter pipeline (lib/keywordFilters.ts) and then the
 * cap-and-rank stage (lib/keywordCapAndRank.ts, brief §5.11) over the
 * keywords this book *already* has — the one-off migration for lists
 * generated before the pipeline existed, and the way to re-apply both after
 * the blocklists, the keyword budget, or the book's metadata change.
 *
 * When AI ranking is configured (GEMINI_API_KEY or OPENROUTER_API_KEY set),
 * an additional AI relevance pass re-orders the surviving keywords before the
 * cap-and-rank step so the best candidates are always in the active window.
 *
 * Only active/paused/rejected/archived rows are touched: a keyword a human
 * marked negative stays where they put it. A row already archived by a
 * previous cap is re-scored on every run, so a keyword ranked out by an
 * earlier, larger candidate pool can rotate back in once the field thins
 * out. `dryRun` reports what would change without writing anything.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });

    const { snapshot } = loaded;
    if (!snapshot.capture.ok || !snapshot.title) {
      return Response.json(
        {
          error:
            "This book's Amazon metadata could not be read, so there are no anchors to filter against. Re-fetch the metadata and try again.",
          needsRefresh: true,
        },
        { status: 422 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const { data: rows, error } = await supabase
      .from("keywords")
      .select("id, text, source, status, match_type, bid, category, specificity")
      .eq("book_id", bookId)
      .in("status", REFILTERABLE_STATUSES);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const keywords = (rows ?? []) as KeywordRow[];
    if (keywords.length === 0) {
      return Response.json({ success: true, examined: 0, changed: 0, summary: null });
    }

    const context = buildFilterContext({
      title: snapshot.title,
      asin: snapshot.asin,
      author: snapshot.author,
      seriesName: snapshot.seriesName,
      description: snapshot.description,
      genreTerms: snapshot.genreTerms,
      genreFamilies: snapshot.genreFamilies,
      categoryPath: snapshot.categoryPath,
      categories: snapshot.categories,
      goodreadsTags: snapshot.goodreadsTags,
      competitors: snapshot.competitors,
      compTitles: snapshot.compTitles,
      reviewSnippets: snapshot.reviewSnippets,
      marketplace: snapshot.marketplace,
      language: snapshot.language,
      formats: snapshot.formats ?? [],
      isKindleUnlimited: !!snapshot.isKindleUnlimited,
    });

    // filterKeywords dedupes on the post-rewrite text, so results are keyed
    // back to rows by the text that went in, not the text that came out.
    const byId = new Map<string, KeywordRow>();
    const filterable: FilterableKeyword[] = keywords.map((row) => {
      byId.set(row.text, row);
      return { text: row.text, source: row.source };
    });

    const { results, summary } = filterKeywords(filterable, context);

    const verdictToStatus = { pass: "active", pause: "paused", reject: "rejected" } as const;
    interface RowOutcome {
      row: KeywordRow;
      status: string;
      reason: string | null;
      filter: string | null;
      text: string;
      specificity: number | null;
    }
    const outcomes: RowOutcome[] = [];
    for (const result of results) {
      const row = byId.get(result.originalText);
      if (!row) continue;
      // Re-score specificity on every filter run, not just at generation time
      // (lib/keywordSpecificity.ts) — a rewrite (dangling-modifier completion)
      // changes the text scoring is based on, and the book's own anchors can
      // change between generate runs too.
      const candidate: KeywordCandidate = {
        text: result.text,
        sources: (row.source ? [row.source as KeywordSource] : []) as KeywordSource[],
        category: (row.category ?? undefined) as KeywordCategory | undefined,
      };
      outcomes.push({
        row,
        status: verdictToStatus[result.verdict],
        // rejection_reason/rejected_by_filter record why the pipeline dropped
        // or paused a row (§ their column comments) — a pass now carries its
        // own positive reason/code (lib/keywordFilters.ts#assignPassReason)
        // for the summary breakdown below, but that isn't a rejection reason
        // and shouldn't overwrite the column for an active keyword.
        reason: result.verdict === "pass" ? null : (result.reason ?? null),
        filter: result.filter ?? null,
        text: result.text,
        specificity: scoreSpecificity(candidate, context.anchors),
      });
    }

    // --- Optional AI relevance re-rank ---
    // After the heuristic filter, run an AI pass over the surviving active
    // keywords to refine their order before the cap-and-rank step. This
    // ensures the best-matching candidates are always in the active window,
    // not just whatever order they happened to be inserted in.
    let aiRanked = false;
    if (isAiRankingConfigured()) {
      const familySearchTerms = genreFamilySearchTerms(snapshot.genreFamilies ?? []);
      const genreSeedTerms = [
        ...(snapshot.genreTerms ?? []).slice(0, 8),
        ...familySearchTerms.slice(0, 4),
      ].filter(Boolean);

      const activeOutcomes = outcomes.filter((o) => o.status === "active");

      // Split into tropes vs comp-names by the keyword's category column,
      // mirroring the generate route's splitKeywordsByCategory logic.
      const tropesHead: KeywordCandidate[] = activeOutcomes
        .filter((o) => o.row.category !== "comp-names")
        .slice(0, AI_REVIEW_LIMIT)
        .map((o) => ({
          text: o.text,
          sources: (o.row.source ? [o.row.source as KeywordSource] : []) as KeywordSource[],
          category: (o.row.category ?? undefined) as KeywordCategory | undefined,
        }));

      const compHead: KeywordCandidate[] = activeOutcomes
        .filter((o) => o.row.category === "comp-names")
        .slice(0, AI_REVIEW_LIMIT)
        .map((o) => ({
          text: o.text,
          sources: (o.row.source ? [o.row.source as KeywordSource] : []) as KeywordSource[],
          category: (o.row.category ?? undefined) as KeywordCategory | undefined,
        }));

      if (tropesHead.length + compHead.length > 0) {
        const ranked = await rankKeywordsWithAi(
          {
            title: snapshot.title,
            author: snapshot.author ?? "",
            seriesName: snapshot.seriesName,
            genreTerms: genreSeedTerms,
            description: snapshot.description,
            pageMarkdown: snapshot.pageMarkdownExcerpt,
          },
          tropesHead,
          compHead
        ).catch((err: Error) => {
          console.error("[filter] AI ranking failed:", err.message);
          return null;
        });

        if (ranked) {
          aiRanked = true;
          // applyAiRelevance reorders within the slice and keeps "drop"
          // verdicts out — those become paused (not hard-rejected) so the
          // user can still override them.
          const rerankedTropes = applyAiRelevance(tropesHead, ranked);
          const rerankedComp = applyAiRelevance(compHead, ranked);

          // Propagate AI scores back into the outcome list for cap-and-rank
          const aiScoreMap = new Map<string, number>();
          for (const c of [...rerankedTropes, ...rerankedComp]) {
            aiScoreMap.set(c.text, c.score ?? 0);
          }

          // Anything the AI explicitly "dropped" (i.e. not in reranked) gets paused
          const rerankedTexts = new Set([...rerankedTropes, ...rerankedComp].map((c) => c.text));
          for (const outcome of activeOutcomes) {
            if (
              !rerankedTexts.has(outcome.text) &&
              (tropesHead.some((c) => c.text === outcome.text) ||
                compHead.some((c) => c.text === outcome.text))
            ) {
              outcome.status = "paused";
              outcome.reason = "Dropped by AI relevance filter as off-topic for this book.";
              outcome.filter = "aiRelevance";
            }
          }
        }
      }
    }

    // §5.11: the drop-rule pipeline alone still leaves keyword dumping — cap
    // the survivors at the book's keyword budget and rank the rest into a
    // backlog rather than reactivating every one of them. Ranked-out
    // keywords are never rejects (they're plausible, just not in the top
    // slice today), so they're archived — kept, inactive, and eligible to be
    // rotated back in on a future re-filter — rather than joining the
    // rejected pile.
    const capCandidates = outcomes
      .filter((outcome) => outcome.status === "active")
      .map((outcome) => ({
        text: outcome.text,
        sources: (outcome.row.source ? [outcome.row.source] : []) as KeywordSource[],
        matchType: outcome.row.match_type,
        bid: outcome.row.bid ?? undefined,
      }));
    // The book pipeline's keyword library is research output, not a single ad
    // group (see the caps note in lib/keywordMerge.ts): it holds up to
    // BOOK_KEYWORD_MAX descriptive keywords and BOOK_COMP_NAME_MAX comp names
    // for review, not capAndRank's own ad-group-sized defaults (150 total /
    // 50 per group). Passing those defaults here — as an earlier version of
    // this route did — meant "Re-run filters" silently archived the bulk of
    // a full-sized keyword list on every run, far below what generation
    // itself produces and the keyword manager is meant to hold.
    const { backlog } = capAndRank(capCandidates, context.anchors, {
      maxKeywordsTotal: BOOK_KEYWORD_MAX + BOOK_COMP_NAME_MAX,
      maxPerAdGroup: { descriptive: BOOK_KEYWORD_MAX, "comp-names": BOOK_COMP_NAME_MAX },
    });
    const backlogByText = new Map(backlog.map((entry) => [entry.text, entry]));

    for (const outcome of outcomes) {
      if (outcome.status !== "active") continue;
      const capped = backlogByText.get(outcome.text);
      if (!capped) continue;
      outcome.status = "archived";
      outcome.reason = capped.reason;
      outcome.filter = capped.filter;
    }

    const updates = outcomes
      .filter(
        (outcome) =>
          outcome.status !== outcome.row.status ||
          outcome.text !== outcome.row.text ||
          outcome.specificity !== outcome.row.specificity
      )
      .map((outcome) => ({
        id: outcome.row.id,
        status: outcome.status,
        reason: outcome.reason,
        filter: outcome.filter,
        text: outcome.text,
        specificity: outcome.specificity,
      }));

    const archivedByCap = outcomes.filter((outcome) => outcome.filter === "capAndRank").length;
    const pausedByAi = outcomes.filter((outcome) => outcome.filter === "aiRelevance").length;

    if (dryRun) {
      return Response.json({
        success: true,
        dryRun: true,
        examined: keywords.length,
        changed: updates.length,
        summary,
        archivedByCap,
        pausedByAi,
        aiRanked,
        preview: updates.slice(0, 50),
      });
    }

    // One statement per row: Supabase has no bulk conditional update, and a
    // full upsert would need every column of every row shipped back. The
    // requests are independent, so they run with bounded concurrency instead
    // of one at a time — a book with hundreds of changed keywords otherwise
    // pays a full network round trip per row, serially.
    const UPDATE_CONCURRENCY = 8;
    const updateOutcomes = await mapWithConcurrency(updates, UPDATE_CONCURRENCY, async (update) => {
      const { error: updateError } = await supabase
        .from("keywords")
        .update({
          status: update.status,
          rejection_reason: update.reason,
          rejected_by_filter: update.filter,
          text: update.text,
          specificity: update.specificity,
        })
        .eq("id", update.id);

      if (updateError) {
        // A database from before sql/09-keyword-specificity.sql has no
        // specificity column — retry without it rather than failing the
        // whole row's status/text update over a missing migration.
        if (/specificity/i.test(updateError.message)) {
          const { error: retryError } = await supabase
            .from("keywords")
            .update({
              status: update.status,
              rejection_reason: update.reason,
              rejected_by_filter: update.filter,
              text: update.text,
            })
            .eq("id", update.id);
          if (!retryError) return true;
        }
        // A rewrite can collide with a keyword that already exists at the new
        // text; that's a duplicate, not a failure worth aborting the run for.
        console.error(`[filter] could not update keyword ${update.id}:`, updateError.message);
        return false;
      }
      return true;
    });
    const changed = updateOutcomes.filter(Boolean).length;

    return Response.json({
      success: true,
      examined: keywords.length,
      changed,
      summary,
      archivedByCap,
      pausedByAi,
      aiRanked,
    });
  } catch (err) {
    console.error("Error filtering keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
