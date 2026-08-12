import { recommendForKeyword, type KeywordPerformance } from "@/lib/recommendations";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const DEFAULT_TARGET_ACOS = 0.3;

/**
 * POST /api/keywords/[id]/restore (batch 12 item 6)
 *
 * Promotes an archived keyword back to `active`. Not unconditional — an
 * archive is a real signal (spend with zero orders), so this is gated on
 * the recommendation engine no longer standing behind that call: if
 * `recommendForKeyword()` would still recommend `archive` given the
 * keyword's current lifetime performance, the restore is refused. A
 * keyword with no results yet (never evaluated) or whose numbers no longer
 * support archiving can be restored.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: keyword, error: keywordError } = await supabase
      .from("keywords")
      .select("id, book_id, bid, status, last_clicks, last_spend, last_sales, last_orders, results_updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (keywordError) return Response.json({ error: keywordError.message }, { status: 400 });
    if (!keyword) return Response.json({ error: "Keyword not found" }, { status: 404 });
    if (keyword.status !== "archived") {
      return Response.json({ error: "Only archived keywords can be restored." }, { status: 400 });
    }

    const { data: book } = await supabase.from("books").select("target_acos").eq("id", keyword.book_id).single();
    const targetAcos = (book?.target_acos as number | null) ?? DEFAULT_TARGET_ACOS;

    const { data: rollup } = await supabase
      .from("keyword_result_rollups")
      .select("lifetime_clicks, lifetime_orders, lifetime_spend")
      .eq("keyword_id", id)
      .maybeSingle();

    const performance: KeywordPerformance = {
      id: keyword.id as string,
      bid: keyword.bid as number | null,
      status: "archived",
      campaignType: null,
      resultsUpdatedAt: keyword.results_updated_at as string | null,
      lifetimeClicks: (rollup?.lifetime_clicks as number | null) ?? null,
      lifetimeOrders: (rollup?.lifetime_orders as number | null) ?? null,
      lifetimeSpend: (rollup?.lifetime_spend as number | null) ?? null,
      lastClicks: keyword.last_clicks as number | null,
      lastSpend: keyword.last_spend as number | null,
      lastSales: keyword.last_sales as number | null,
      lastOrders: keyword.last_orders as number | null,
    };

    const recs = recommendForKeyword(performance, targetAcos);
    const stillArchivable = recs.find((r) => r.type === "archive");
    if (stillArchivable) {
      return Response.json(
        { error: `The recommendation engine still suggests archiving this keyword: ${stillArchivable.reason}` },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("keywords")
      .update({ status: "active" })
      .eq("id", id)
      .select()
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    return Response.json({ keyword: updated });
  } catch (err) {
    console.error("Error restoring keyword:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
