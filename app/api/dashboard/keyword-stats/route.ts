import { summarizeKeywordStats } from "@/lib/dashboardStats";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/keyword-stats
 *
 * Dashboard "Keyword stats" + "Specificity distribution" widgets
 * (Enhancements spec §2), plus the §16 "which filters reject the most"
 * breakdown that motivates the allowlist flow. Each dashboard widget owns
 * its own fetch so one failing query never blanks the rest of the page.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("keywords")
      .select("status, match_type, source, specificity, rejected_by_filter")
      .eq("user_id", user.id);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ success: true, stats: summarizeKeywordStats(data ?? []) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
