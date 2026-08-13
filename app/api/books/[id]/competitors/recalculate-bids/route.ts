import { computeCompetitorBid } from "@/lib/competitorBidding";
import { getCompetitorAsins } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * POST /api/books/[id]/competitors/recalculate-bids
 *
 * Bulk action (competitor-ASIN enhancements task 2): recomputes
 * competitor_asins.bid for every tracked ASIN (or just `ids`, when the
 * manager's multi-select toolbar passes a subset) from each row's already-
 * stored metadata (price/bsr/competitor_count/mean_rank —
 * sql/17-competitor-asin-metadata.sql), using the same computeCompetitorBid
 * used at generation time. Never re-fetches metadata — this is a pure
 * re-score of what's already on the row.
 *
 * Body: { ids?: string[] } — omit to recalculate every tracked ASIN.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids: string[] | undefined = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : undefined;

    const supabase = await supabaseServer();
    const { data: all } = await getCompetitorAsins(supabase, bookId, user.id);
    const targets = ids ? all.filter((row) => ids.includes(row.id)) : all;

    if (targets.length === 0) return Response.json({ success: true, updatedCount: 0 });

    const rows = targets.map((row) => ({
      book_id: bookId,
      user_id: user.id,
      competitor_asin: row.competitor_asin,
      bid: computeCompetitorBid({
        price: row.price,
        bsr: row.bsr,
        competitorCount: row.competitor_count,
        meanRank: row.mean_rank,
      }),
    }));

    const { data, error } = await supabase
      .from("competitor_asins")
      .upsert(rows, { onConflict: "book_id,competitor_asin", ignoreDuplicates: false })
      .select("id");

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ success: true, updatedCount: data?.length ?? 0 });
  } catch (err) {
    console.error("Error recalculating competitor ASIN bids:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
