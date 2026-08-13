import { summarizeCampaigns } from "@/lib/dashboardStats";
import { fetchAllRows } from "@/lib/supabasePaging";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/campaign-summary
 *
 * Dashboard "Campaign performance" widget: lifetime spend/sales/ACOS across
 * every campaign the user has ever exported, plus a per-period breakdown for
 * the spend-over-time bars. Own route (rather than reusing /api/campaigns)
 * since the dashboard only needs the aggregate, not every campaign row.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [{ data: campaigns, error: campaignsError }, { data: results, error: resultsError }] = await Promise.all([
      fetchAllRows(
        (from, to) =>
          supabase.from("campaigns").select("id, status").eq("user_id", user.id).order("id").range(from, to),
        { label: "dashboard/campaign-summary:campaigns" }
      ),
      // Paged: campaign_results grows by a row per keyword per report period,
      // so it is the fastest-growing table here. Lifetime spend/sales/ACOS is
      // summed from these rows — a truncated read would under-report money.
      fetchAllRows(
        (from, to) =>
          supabase
            .from("campaign_results")
            .select("campaign_id, spend, sales, orders, clicks, impressions, report_start, report_end")
            .eq("user_id", user.id)
            .order("id")
            .range(from, to),
        { label: "dashboard/campaign-summary:results" }
      ),
    ]);

    if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });
    if (resultsError) return Response.json({ error: resultsError.message }, { status: 400 });

    return Response.json({ success: true, summary: summarizeCampaigns(campaigns ?? [], results ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
