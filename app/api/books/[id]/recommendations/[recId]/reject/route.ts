import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * POST /api/books/[id]/recommendations/[recId]/reject (campaigns spec §6/§7)
 *
 * Marks the recommendation rejected. No side effect on the keyword/ASIN
 * itself — the cooldown (lib/recommendations.ts's shouldSuppressRecommendation,
 * 30 days) is enforced on the next GET .../recommendations regeneration,
 * not here.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; recId: string }> }
) {
  try {
    const { id: bookId, recId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: rec, error: recError } = await supabase
      .from("keyword_recommendations")
      .select("id, status")
      .eq("id", recId)
      .eq("book_id", bookId)
      .single();
    if (recError || !rec)
      return Response.json({ error: "Recommendation not found" }, { status: 404 });
    if (rec.status !== "pending") {
      return Response.json({ error: `Recommendation is already ${rec.status}` }, { status: 409 });
    }

    const { data: updated, error: updateError } = await supabase
      .from("keyword_recommendations")
      .update({ status: "rejected", decided_at: new Date().toISOString() })
      .eq("id", recId)
      .select()
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    return Response.json({ recommendation: updated });
  } catch (err) {
    console.error("Error rejecting recommendation:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
