import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildFilterContext, filterKeywords, type FilterableKeyword } from "@/lib/keywordFilters";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Statuses the pipeline is allowed to change. A negative or archived keyword is a human decision. */
const REFILTERABLE_STATUSES = ["active", "paused", "rejected"];

interface KeywordRow {
  id: string;
  text: string;
  source: string | null;
  status: string;
}

/**
 * POST /api/books/[id]/keywords/filter
 * Body: { dryRun?: boolean }
 *
 * Runs the filter pipeline (lib/keywordFilters.ts) over the keywords this
 * book *already* has — the one-off migration for lists generated before the
 * pipeline existed, and the way to re-apply it after the blocklists or the
 * book's metadata change.
 *
 * Only active/paused/rejected rows are touched: a keyword a human marked
 * negative or archived stays where they put it. `dryRun` reports what would
 * change without writing anything.
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

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    const { data: rows, error } = await supabase
      .from("keywords")
      .select("id, text, source, status")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", REFILTERABLE_STATUSES);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const keywords = (rows ?? []) as KeywordRow[];
    if (keywords.length === 0) {
      return Response.json({ success: true, examined: 0, changed: 0, summary: null });
    }

    const context = buildFilterContext({
      title: snapshot.title,
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
    const updates: Array<{ id: string; status: string; reason: string | null; filter: string | null; text: string }> = [];

    for (const result of results) {
      const row = byId.get(result.originalText);
      if (!row) continue;
      const status = verdictToStatus[result.verdict];
      if (status === row.status && !result.rewritten) continue;
      updates.push({
        id: row.id,
        status,
        reason: result.reason ?? null,
        filter: result.filter ?? null,
        text: result.text,
      });
    }

    if (dryRun) {
      return Response.json({
        success: true,
        dryRun: true,
        examined: keywords.length,
        changed: updates.length,
        summary,
        preview: updates.slice(0, 50),
      });
    }

    // One statement per row: Supabase has no bulk conditional update, and a
    // full upsert would need every column of every row shipped back.
    let changed = 0;
    for (const update of updates) {
      const { error: updateError } = await supabase
        .from("keywords")
        .update({
          status: update.status,
          rejection_reason: update.reason,
          rejected_by_filter: update.filter,
          text: update.text,
        })
        .eq("id", update.id)
        .eq("user_id", user.id);

      if (updateError) {
        // A rewrite can collide with a keyword that already exists at the new
        // text; that's a duplicate, not a failure worth aborting the run for.
        console.error(`[filter] could not update keyword ${update.id}:`, updateError.message);
        continue;
      }
      changed += 1;
    }

    return Response.json({
      success: true,
      examined: keywords.length,
      changed,
      summary,
    });
  } catch (err) {
    console.error("Error filtering keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
