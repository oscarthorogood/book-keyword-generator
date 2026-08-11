import { loadBookWithSnapshot } from "@/lib/bookStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** Statuses the pipeline is allowed to change. A negative ASIN is a human decision. */
const REFILTERABLE_STATUSES = ["active", "paused", "rejected", "archived"];

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  status: string;
}

/**
 * POST /api/books/[id]/competitors/filter
 *
 * "Re-run filters" for the Competitors tab — re-validates every tracked
 * competitor ASIN against this book's own ASIN and basic ASIN shape,
 * mirroring app/api/books/[id]/keywords/filter/route.ts. There's no text
 * relevance to score (an ASIN carries no semantic content of its own), so
 * the pipeline here is narrower: an ASIN is rejected only if it's
 * malformed or turns out to be the book's own ASIN.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });

    const ownAsin = (loaded.snapshot.asin ?? loaded.book.asin ?? "").toUpperCase();

    const { data: rows, error } = await supabase
      .from("competitor_asins")
      .select("id, competitor_asin, status")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", REFILTERABLE_STATUSES);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const asins = (rows ?? []) as CompetitorAsinRow[];
    if (asins.length === 0) {
      return Response.json({ success: true, examined: 0, changed: 0 });
    }

    let changed = 0;
    for (const row of asins) {
      const asin = row.competitor_asin.toUpperCase();
      let status = "active";
      let reason: string | null = null;
      let filter: string | null = null;

      if (!ASIN_PATTERN.test(asin)) {
        status = "rejected";
        reason = "Not a well-formed 10-character ASIN.";
        filter = "asinFormat";
      } else if (asin === ownAsin) {
        status = "rejected";
        reason = "This is the book's own ASIN, not a competitor.";
        filter = "selfAsin";
      }

      if (status === row.status) continue;

      const { error: updateError } = await supabase
        .from("competitor_asins")
        .update({ status, rejection_reason: reason, rejected_by_filter: filter })
        .eq("id", row.id)
        .eq("user_id", user.id);

      if (updateError) {
        console.error(`[competitors filter] could not update ${row.id}:`, updateError.message);
        continue;
      }
      changed += 1;
    }

    return Response.json({ success: true, examined: asins.length, changed });
  } catch (err) {
    console.error("Error filtering competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
