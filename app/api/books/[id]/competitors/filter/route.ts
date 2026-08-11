import { isAiRankingConfigured, rankKeywordsWithAi } from "@/lib/aiRanker";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { mapWithConcurrency } from "@/lib/concurrency";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { genreFamilySearchTerms } from "@/lib/genre";

export const runtime = "nodejs";
export const maxDuration = 60;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** Statuses the pipeline is allowed to change. A negative ASIN is a human decision. */
const REFILTERABLE_STATUSES = ["active", "paused", "rejected", "archived"];

/**
 * Score threshold below which an ASIN is considered AI-irrelevant enough to
 * be paused (not rejected — it may still be a valid comp, just low-signal).
 * Only applied when AI ranking is configured and the notes field has enough
 * semantic content to judge on.
 */
const AI_PAUSE_SCORE_THRESHOLD = 20;

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  status: string;
  notes: string | null;
}

/**
 * POST /api/books/[id]/competitors/filter
 *
 * "Re-run filters" for the Competitors tab — re-validates every tracked
 * competitor ASIN against this book's own ASIN and basic ASIN shape,
 * mirroring app/api/books/[id]/keywords/filter/route.ts.
 *
 * When AI ranking is configured (GEMINI_API_KEY or OPENROUTER_API_KEY set),
 * a second pass judges each ASIN's notes/title text for relevance to this
 * book — low-scoring ones are paused rather than rejected, preserving human
 * override. ASINs whose notes field is empty are skipped by the AI pass.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });

    const { snapshot } = loaded;
    const ownAsin = (snapshot.asin ?? loaded.book.asin ?? "").toUpperCase();

    const { data: rows, error } = await supabase
      .from("competitor_asins")
      .select("id, competitor_asin, status, notes")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", REFILTERABLE_STATUSES);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const asins = (rows ?? []) as CompetitorAsinRow[];
    if (asins.length === 0) {
      return Response.json({ success: true, examined: 0, changed: 0 });
    }

    interface AsinOutcome {
      row: CompetitorAsinRow;
      status: string;
      reason: string | null;
      filter: string | null;
    }

    const outcomes: AsinOutcome[] = asins.map((row) => ({
      row,
      status: "active",
      reason: null,
      filter: null,
    }));

    // --- Heuristic filter pass ---
    for (const outcome of outcomes) {
      const asin = outcome.row.competitor_asin.toUpperCase();
      if (!ASIN_PATTERN.test(asin)) {
        outcome.status = "rejected";
        outcome.reason = "Not a well-formed 10-character ASIN.";
        outcome.filter = "asinFormat";
      } else if (asin === ownAsin) {
        outcome.status = "rejected";
        outcome.reason = "This is the book's own ASIN, not a competitor.";
        outcome.filter = "selfAsin";
      }
    }

    // --- AI relevance pass ---
    // Uses the notes/title fields attached to each ASIN as proxy text.
    // Only runs against the ASINs that survived heuristics and have notes.
    let aiRanked = false;
    if (isAiRankingConfigured() && snapshot.title) {
      const familySearchTerms = genreFamilySearchTerms(snapshot.genreFamilies ?? []);
      const genreSeedTerms = [...(snapshot.genreTerms ?? []).slice(0, 8), ...familySearchTerms.slice(0, 4)].filter(Boolean);

      // Build pseudo-keyword candidates from the ASIN's notes text so we can
      // pass them through the existing rankKeywordsWithAi interface.
      const activeOutcomes = outcomes.filter((o) => o.status === "active" && !!o.row.notes);

      if (activeOutcomes.length > 0) {
        const compNameCandidates = activeOutcomes.map((o) => ({
          text: o.row.notes as string,
          sources: ["comp-name" as const],
        }));

        const ranked = await rankKeywordsWithAi(
          {
            title: snapshot.title,
            author: snapshot.author ?? "",
            seriesName: snapshot.seriesName,
            genreTerms: genreSeedTerms,
            description: snapshot.description,
            pageMarkdown: snapshot.pageMarkdownExcerpt,
          },
          [],           // no tropes — we only care about comp relevance
          compNameCandidates
        ).catch((err: Error) => {
          console.error("[competitors filter] AI ranking failed:", err.message);
          return null;
        });

        if (ranked) {
          aiRanked = true;
          const byText = new Map(ranked.map((r) => [r.text, r]));

          for (const outcome of activeOutcomes) {
            const verdict = byText.get(outcome.row.notes as string);
            if (!verdict) continue;
            // Explicit "drop" from AI or score below the pause threshold:
            // pause rather than reject so the user can still override.
            if (verdict.category === "drop" || verdict.score < AI_PAUSE_SCORE_THRESHOLD) {
              outcome.status = "paused";
              outcome.reason = `AI relevance score ${verdict.score}/100 — lower than expected for this book's genre.`;
              outcome.filter = "aiRelevance";
            }
          }
        }
      }
    }

    const updates = outcomes.filter(
      (outcome) => outcome.status !== outcome.row.status
    );

    // Independent per-row updates: run with bounded concurrency rather than
    // one at a time so a book with many changed ASINs doesn't pay a full
    // network round trip per row, serially.
    const UPDATE_CONCURRENCY = 8;
    const updateOutcomes = await mapWithConcurrency(updates, UPDATE_CONCURRENCY, async (outcome) => {
      const { error: updateError } = await supabase
        .from("competitor_asins")
        .update({ status: outcome.status, rejection_reason: outcome.reason, rejected_by_filter: outcome.filter })
        .eq("id", outcome.row.id)
        .eq("user_id", user.id);

      if (updateError) {
        console.error(`[competitors filter] could not update ${outcome.row.id}:`, updateError.message);
        return false;
      }
      return true;
    });
    const changed = updateOutcomes.filter(Boolean).length;

    return Response.json({ success: true, examined: asins.length, changed, aiRanked });
  } catch (err) {
    console.error("Error filtering competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
