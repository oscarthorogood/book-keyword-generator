import { recommendForCompetitorAsin, type KeywordPerformance } from "@/lib/recommendations";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const DEFAULT_TARGET_ACOS = 0.3;

/**
 * POST /api/competitors/[id]/restore (batch 12 item 6) — mirrors
 * app/api/keywords/[id]/restore/route.ts for competitor ASINs: only
 * restores an archived ASIN to `active` when `recommendForCompetitorAsin()`
 * no longer stands behind the archive call.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: asin, error: asinError } = await supabase
      .from("competitor_asins")
      .select("id, book_id, bid, status, last_clicks, last_spend, last_sales, last_orders, results_updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (asinError) return Response.json({ error: asinError.message }, { status: 400 });
    if (!asin) return Response.json({ error: "Competitor ASIN not found" }, { status: 404 });
    if (asin.status !== "archived") {
      return Response.json({ error: "Only archived competitor ASINs can be restored." }, { status: 400 });
    }

    const { data: book } = await supabase.from("books").select("target_acos").eq("id", asin.book_id).single();
    const targetAcos = (book?.target_acos as number | null) ?? DEFAULT_TARGET_ACOS;

    const { data: rollup } = await supabase
      .from("competitor_asin_result_rollups")
      .select("lifetime_clicks, lifetime_orders, lifetime_spend")
      .eq("competitor_asin_id", id)
      .maybeSingle();

    const performance: KeywordPerformance = {
      id: asin.id as string,
      bid: asin.bid as number | null,
      status: "archived",
      campaignType: null,
      resultsUpdatedAt: asin.results_updated_at as string | null,
      lifetimeClicks: (rollup?.lifetime_clicks as number | null) ?? null,
      lifetimeOrders: (rollup?.lifetime_orders as number | null) ?? null,
      lifetimeSpend: (rollup?.lifetime_spend as number | null) ?? null,
      lastClicks: asin.last_clicks as number | null,
      lastSpend: asin.last_spend as number | null,
      lastSales: asin.last_sales as number | null,
      lastOrders: asin.last_orders as number | null,
    };

    const recs = recommendForCompetitorAsin(performance, targetAcos);
    const stillArchivable = recs.find((r) => r.type === "archive");
    if (stillArchivable) {
      return Response.json(
        { error: `The recommendation engine still suggests archiving this ASIN: ${stillArchivable.reason}` },
        { status: 400 }
      );
    }

    const { data: updated, error: updateError } = await supabase
      .from("competitor_asins")
      .update({ status: "active" })
      .eq("id", id)
      .select()
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    return Response.json({ competitor: updated });
  } catch (err) {
    console.error("Error restoring competitor ASIN:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
