import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/books/[id]/target-memberships (batch 12 item 3)
 *
 * Which campaign(s) each keyword/competitor-ASIN row is currently active in
 * — joins campaign_targets (non-archived, non-negative rows only, latest
 * row per target wins) against campaigns.name, keyed by keyword_id /
 * competitor_asin_id so the combined bank table can show a badge per row.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookId } = await params;

  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await supabaseServer();

  const { data: campaigns, error: campaignsError } = await supabase
    .from("campaigns")
    .select("id, name")
    .eq("book_id", bookId)
    .eq("user_id", user.id);
  if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });

  const campaignIds = (campaigns ?? []).map((c) => c.id as string);
  if (campaignIds.length === 0) return Response.json({ keywordCampaigns: {}, competitorCampaigns: {} });
  const nameById = new Map((campaigns ?? []).map((c) => [c.id as string, c.name as string]));

  const { data: targets, error: targetsError } = await supabase
    .from("campaign_targets")
    .select("campaign_id, keyword_id, competitor_asin_id, state, is_negative, created_at")
    .in("campaign_id", campaignIds)
    .eq("is_negative", false)
    .neq("state", "archived");
  if (targetsError) return Response.json({ error: targetsError.message }, { status: 400 });

  const keywordCampaigns: Record<string, string[]> = {};
  const competitorCampaigns: Record<string, string[]> = {};

  for (const t of targets ?? []) {
    const campaignName = nameById.get(t.campaign_id as string);
    if (!campaignName) continue;
    if (t.keyword_id) {
      const list = (keywordCampaigns[t.keyword_id as string] ??= []);
      if (!list.includes(campaignName)) list.push(campaignName);
    }
    if (t.competitor_asin_id) {
      const list = (competitorCampaigns[t.competitor_asin_id as string] ??= []);
      if (!list.includes(campaignName)) list.push(campaignName);
    }
  }

  return Response.json({ keywordCampaigns, competitorCampaigns });
}
