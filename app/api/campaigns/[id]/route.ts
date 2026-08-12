import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/campaigns/[id] (campaigns spec §7)
 *
 * One sub-campaign: its own row, the parent book, its `campaign_targets`
 * (export history — what was last exported and each target's operation),
 * and a lifetime `campaign_results` rollup (spend/sales/orders → ACOS).
 * Recommendations are fetched separately by `RecommendationsPanel`
 * (book-scoped) and filtered client-side to this campaign's id.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: campaignId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", campaignId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (campaignError) return Response.json({ error: campaignError.message }, { status: 400 });
    if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

    const [{ data: book }, { data: targets }, { data: results }] = await Promise.all([
      supabase.from("books").select("id, title, author, asin").eq("id", campaign.book_id).maybeSingle(),
      supabase
        .from("campaign_targets")
        .select("id, target_text, match_type, targeting_expression, bid, state, operation, is_negative, negative_scope, created_at")
        .eq("campaign_id", campaignId)
        .order("created_at", { ascending: false }),
      supabase
        .from("campaign_results")
        .select("impressions, clicks, spend, sales, orders, report_start, report_end")
        .eq("campaign_id", campaignId)
        .order("report_start", { ascending: true }),
    ]);

    const totals = (results ?? []).reduce(
      (acc, r) => ({
        impressions: acc.impressions + (r.impressions ?? 0),
        clicks: acc.clicks + (r.clicks ?? 0),
        spend: acc.spend + Number(r.spend ?? 0),
        sales: acc.sales + Number(r.sales ?? 0),
        orders: acc.orders + (r.orders ?? 0),
      }),
      { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 }
    );
    const acos = totals.sales > 0 ? totals.spend / totals.sales : null;

    return Response.json({
      campaign,
      book: book ?? null,
      targets: targets ?? [],
      results: results ?? [],
      totals: { ...totals, acos },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
