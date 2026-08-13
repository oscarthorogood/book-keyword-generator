import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/overview-stats
 *
 * The top-of-dashboard KPI tile row: headline counts across every book,
 * keyword, and campaign the user owns. Uses `count: "exact", head: true`
 * queries so this stays cheap even as the tables grow — no rows are
 * fetched, just totals.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [books, activeKeywords, campaigns, liveCampaigns] = await Promise.all([
      supabase.from("books").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase
        .from("keywords")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "active"),
      supabase.from("campaigns").select("id", { count: "exact", head: true }).eq("user_id", user.id),
      supabase
        .from("campaigns")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("status", "live"),
    ]);

    for (const result of [books, activeKeywords, campaigns, liveCampaigns]) {
      if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      stats: {
        bookCount: books.count ?? 0,
        activeKeywordCount: activeKeywords.count ?? 0,
        campaignCount: campaigns.count ?? 0,
        liveCampaignCount: liveCampaigns.count ?? 0,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
