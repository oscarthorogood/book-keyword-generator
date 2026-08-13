import { targetKey } from "@/lib/campaignDiff";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

interface CampaignTargetRow {
  id: string;
  keyword_id: string | null;
  competitor_asin_id: string | null;
  target_text: string;
  match_type: MatchType | null;
  targeting_expression: string | null;
  bid: number | null;
  state: "enabled" | "paused" | "archived";
  operation: "Create" | "Update" | "Archive";
  is_negative: boolean;
  created_at: string;
}

/**
 * GET /api/books/[id]/campaigns/[campaignId]/targets
 *
 * The "as currently exported" keyword/ASIN list for Manual Update's swap
 * popup — same latest-row-per-key reconstruction the PATCH (Automatic
 * update) route uses, but read-only and exposed for the UI to list rather
 * than folded straight into a diff.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; campaignId: string }> }) {
  try {
    const { id: bookId, campaignId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, book_id, campaign_type, status")
      .eq("id", campaignId)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (campaignError) return Response.json({ error: campaignError.message }, { status: 400 });
    if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

    const { data: rows, error: targetsError } = await supabase
      .from("campaign_targets")
      .select(
        "id, keyword_id, competitor_asin_id, target_text, match_type, targeting_expression, bid, state, operation, is_negative, created_at"
      )
      .eq("campaign_id", campaignId);
    if (targetsError) return Response.json({ error: targetsError.message }, { status: 400 });

    const latestByKey = new Map<string, CampaignTargetRow>();
    for (const row of (rows ?? []) as CampaignTargetRow[]) {
      if (row.is_negative) continue;
      const key = targetKey({
        keywordId: row.keyword_id ?? undefined,
        competitorAsinId: row.competitor_asin_id ?? undefined,
        text: row.target_text,
        matchType: row.match_type ?? undefined,
        targetingExpression: row.targeting_expression ?? undefined,
        bid: row.bid,
        state: row.state,
      });
      const existing = latestByKey.get(key);
      if (!existing || row.created_at > existing.created_at) latestByKey.set(key, row);
    }

    const targets = [...latestByKey.values()]
      .filter((r) => r.operation !== "Archive")
      .map((r) => ({
        id: r.id,
        keywordId: r.keyword_id,
        competitorAsinId: r.competitor_asin_id,
        text: r.target_text,
        matchType: r.match_type,
        targetingExpression: r.targeting_expression,
        bid: r.bid,
        type: r.competitor_asin_id ? ("asin" as const) : ("keyword" as const),
      }));

    return Response.json({ campaign, targets });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
