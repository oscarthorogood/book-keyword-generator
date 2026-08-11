import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildFilterContext, filterKeywords, type FilterableKeyword } from "@/lib/keywordFilters";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Statuses the pipeline is allowed to change. A negative keyword is a human decision. */
const REFILTERABLE_STATUSES = ["active", "paused", "rejected", "archived"];

interface CompetitorKeywordRow {
  id: string;
  text: string;
  status: string;
  match_type: MatchType;
}

/**
 * POST /api/books/[id]/competitor-keywords/filter
 *
 * Re-runs the same relevance-filter pipeline used for keywords
 * (lib/keywordFilters.ts) over this book's competitor keywords — the
 * "Re-run filters" action card on the Competitors tab, mirroring
 * app/api/books/[id]/keywords/filter/route.ts. Every competitor keyword is
 * tagged with the "reverse-asin" source, since that's the only source this
 * table's rows ever come from (lib/reverseAsin.ts).
 *
 * Only active/paused/rejected/archived rows are touched: a row a human
 * marked negative stays where they put it.
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

    const { data: rows, error } = await supabase
      .from("competitor_keywords")
      .select("id, text, status, match_type")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", REFILTERABLE_STATUSES);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const keywords = (rows ?? []) as CompetitorKeywordRow[];
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

    const byId = new Map<string, CompetitorKeywordRow>();
    const filterable: FilterableKeyword[] = keywords.map((row) => {
      byId.set(row.text, row);
      return { text: row.text, source: "reverse-asin" };
    });

    const { results, summary } = filterKeywords(filterable, context);

    const verdictToStatus = { pass: "active", pause: "paused", reject: "rejected" } as const;
    interface RowOutcome {
      row: CompetitorKeywordRow;
      status: string;
      reason: string | null;
      filter: string | null;
      text: string;
    }
    const outcomes: RowOutcome[] = [];
    for (const result of results) {
      const row = byId.get(result.originalText);
      if (!row) continue;
      outcomes.push({
        row,
        status: verdictToStatus[result.verdict],
        reason: result.reason ?? null,
        filter: result.filter ?? null,
        text: result.text,
      });
    }

    const updates = outcomes
      .filter((outcome) => outcome.status !== outcome.row.status || outcome.text !== outcome.row.text)
      .map((outcome) => ({
        id: outcome.row.id,
        status: outcome.status,
        reason: outcome.reason,
        filter: outcome.filter,
        text: outcome.text,
      }));

    let changed = 0;
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from("competitor_keywords")
        .update({
          status: update.status,
          rejection_reason: update.reason,
          rejected_by_filter: update.filter,
          text: update.text,
        })
        .eq("id", update.id)
        .eq("user_id", user.id);

      if (updateError) {
        console.error(`[competitor-keywords filter] could not update ${update.id}:`, updateError.message);
        continue;
      }
      changed += 1;
    }

    return Response.json({ success: true, examined: keywords.length, changed, summary });
  } catch (err) {
    console.error("Error filtering competitor keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
