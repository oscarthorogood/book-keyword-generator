import { buildCampaignReviewWorkbook, type CampaignReviewSheet } from "@/lib/bulksheetXlsx";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 30;

interface TargetRow {
  campaign_id: string;
  keyword_id: string | null;
  competitor_asin_id: string | null;
  target_text: string;
  match_type: string | null;
  bid: number | null;
  state: string;
  is_negative: boolean;
  created_at: string;
}

/**
 * GET /api/books/[id]/campaigns/export
 *
 * Human-facing export: one .xlsx workbook, one sheet per campaign
 * (skipping campaigns with no live targets), columns ASIN/Keyword | Type |
 * Bid. Reads the latest live state per target from `campaign_targets`
 * (same "latest row per target key, drop archived" reconstruction the
 * Update Campaign diff uses) rather than re-running selection, so the
 * export always matches what was actually last exported/updated.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: campaigns, error: campaignsError } = await supabase
      .from("campaigns")
      .select("id, name")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .not("bulksheet_path", "is", null)
      .order("name");
    if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });
    if (!campaigns || campaigns.length === 0) {
      return Response.json({ error: "No exported campaigns to export yet." }, { status: 400 });
    }

    const { data: targetRows, error: targetsError } = await supabase
      .from("campaign_targets")
      .select("campaign_id, keyword_id, competitor_asin_id, target_text, match_type, bid, state, is_negative, created_at")
      .in(
        "campaign_id",
        campaigns.map((c) => c.id)
      );
    if (targetsError) return Response.json({ error: targetsError.message }, { status: 400 });

    const rowsByCampaign = new Map<string, TargetRow[]>();
    for (const row of (targetRows ?? []) as TargetRow[]) {
      if (!rowsByCampaign.has(row.campaign_id)) rowsByCampaign.set(row.campaign_id, []);
      rowsByCampaign.get(row.campaign_id)!.push(row);
    }

    const sheets: CampaignReviewSheet[] = [];
    for (const campaign of campaigns) {
      const rows = rowsByCampaign.get(campaign.id) ?? [];

      // Latest row per target (keyword/ASIN/text), dropping negatives and
      // anything archived — same reconstruction as the Update Campaign diff
      // snapshot, just without needing lib/campaignDiff's DiffCampaignTarget shape.
      const latestByTarget = new Map<string, TargetRow>();
      for (const row of rows) {
        if (row.is_negative) continue;
        const key = row.keyword_id ?? row.competitor_asin_id ?? row.target_text;
        const existing = latestByTarget.get(key);
        if (!existing || row.created_at > existing.created_at) latestByTarget.set(key, row);
      }
      const live = [...latestByTarget.values()].filter((r) => r.state !== "archived");
      if (live.length === 0) continue;

      sheets.push({
        sheetName: campaign.name,
        rows: live.map((r) => ({
          targetText: r.target_text,
          type: r.competitor_asin_id ? "ASIN" : (r.match_type ?? "keyword"),
          bid: r.bid,
        })),
      });
    }

    if (sheets.length === 0) {
      return Response.json({ error: "No live targets to export yet." }, { status: 400 });
    }

    const buffer = await buildCampaignReviewWorkbook(sheets);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="campaigns-export.xlsx"`,
      },
    });
  } catch (err) {
    console.error("Error exporting campaigns:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
