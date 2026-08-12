import { randomUUID } from "node:crypto";
import { buildUpdateReviewRows, buildUpdateUploadRows } from "@/lib/campaignBulksheetExport";
import { buildCampaignPlans } from "@/lib/campaignBulksheetPlan";
import { loadCampaignContext } from "@/lib/campaignContext";
import { toCsv } from "@/lib/bulksheetSchema";
import { buildUploadXlsx } from "@/lib/bulksheetXlsx";
import { diffCampaignTargets, targetKey, type DiffCampaignTarget } from "@/lib/campaignDiff";
import { SINGLE_AD_GROUP_LABEL, type CampaignType } from "@/lib/campaignSelection";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

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

function toDiffTarget(row: CampaignTargetRow): DiffCampaignTarget {
  return {
    keywordId: row.keyword_id ?? undefined,
    competitorAsinId: row.competitor_asin_id ?? undefined,
    text: row.target_text,
    matchType: row.match_type ?? undefined,
    targetingExpression: row.targeting_expression ?? undefined,
    bid: row.bid,
    state: row.state,
  };
}

/**
 * Reconstructs the "as currently exported" snapshot from campaign_targets.
 * Each Update Campaign run only inserts the *changed* rows (spec §4 step
 * 2's "nothing changed -> no row at all"), so the effective snapshot is the
 * most recent row per target key, with already-archived targets dropped —
 * otherwise a target archived in a prior Update would be re-emitted as
 * Operation: Archive forever.
 */
function buildSnapshot(rows: CampaignTargetRow[]): DiffCampaignTarget[] {
  const latestByKey = new Map<string, CampaignTargetRow>();
  for (const row of rows.filter((r) => !r.is_negative)) {
    const key = targetKey(toDiffTarget(row));
    const existing = latestByKey.get(key);
    if (!existing || row.created_at > existing.created_at) {
      latestByKey.set(key, row);
    }
  }
  return [...latestByKey.values()].filter((r) => r.operation !== "Archive").map(toDiffTarget);
}

/**
 * PATCH /api/books/[id]/campaigns/[campaignId] (campaigns spec §4, PR 9c)
 *
 * Body: `{ amazonCampaignId: string }` just persists the pasted-back Amazon
 * campaign id (spec §4 step 8) — no diff runs. Any other body (or none)
 * triggers the diff-based Update Campaign flow: re-run the one selector
 * for this campaign's type, diff against the reconstructed snapshot, and
 * upload only the changed rows.
 *
 * Deviation from the spec's literal step 4 ("insert a new campaigns row"):
 * `campaigns_unique_name_per_user` (sql/21, already live) makes that
 * impossible — the bulksheet's Campaign Name must stay stable for Amazon
 * and for Search Term Report matching (spec §5 step 5). This updates the
 * existing row in place instead (new export_batch_id, operation: 'update',
 * refreshed bulksheet), which also preserves amazon_campaign_id without
 * re-pasting it after every update.
 *
 * Only the five single-ad-group campaign types are supported — Auto
 * Discovery has multiple ad groups and buildUpdateReviewRows/
 * buildUpdateUploadRows take one ad group for the whole diffed batch.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; campaignId: string }> }) {
  try {
    const { id: bookId, campaignId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, book_id, campaign_type, name, daily_budget, status, amazon_campaign_id")
      .eq("id", campaignId)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (campaignError) return Response.json({ error: campaignError.message }, { status: 400 });
    if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));

    if (typeof body.amazonCampaignId === "string" && body.amazonCampaignId.trim()) {
      const { data: updated, error } = await supabase
        .from("campaigns")
        .update({ amazon_campaign_id: body.amazonCampaignId.trim() })
        .eq("id", campaignId)
        .select()
        .single();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      return Response.json({ campaign: updated });
    }

    if (campaign.status !== "exported") {
      return Response.json(
        { error: "This campaign hasn't been exported yet — use Create Campaign first." },
        { status: 400 }
      );
    }
    if (!campaign.amazon_campaign_id) {
      return Response.json(
        { error: "This campaign needs its Amazon Campaign ID pasted in (after uploading the Create Campaign bulksheet) before it can be updated." },
        { status: 400 }
      );
    }

    const campaignType = campaign.campaign_type as CampaignType;
    const adGroup = SINGLE_AD_GROUP_LABEL[campaignType];
    if (!adGroup) {
      return Response.json({ error: "Update Campaign isn't supported for Auto Discovery." }, { status: 400 });
    }

    const context = await loadCampaignContext(supabase, bookId, user.id);
    if (!context) return Response.json({ error: "Book not found" }, { status: 404 });
    const { campaignBook, bank, asinBank, siblingBooks, negatives, anchors } = context;

    const plans = buildCampaignPlans({
      book: campaignBook,
      bank,
      anchors,
      asinBank,
      siblingBooks,
      negatives,
      dailyBudgetPerCampaign: campaign.daily_budget,
      includeAutoDiscovery: false,
    });
    const plan = plans.find((p) => p.campaignType === campaignType);

    const current: DiffCampaignTarget[] = (plan?.targets ?? []).map((t) => ({
      keywordId: t.keywordId,
      competitorAsinId: t.competitorAsinId,
      text: t.text,
      matchType: t.matchType,
      targetingExpression: t.targetingExpression,
      bid: t.bid,
      state: "enabled",
    }));

    const { data: previousTargetRows, error: previousTargetsError } = await supabase
      .from("campaign_targets")
      .select("id, keyword_id, competitor_asin_id, target_text, match_type, targeting_expression, bid, state, operation, is_negative, created_at")
      .eq("campaign_id", campaignId);
    if (previousTargetsError) return Response.json({ error: previousTargetsError.message }, { status: 400 });

    const snapshot = buildSnapshot((previousTargetRows ?? []) as CampaignTargetRow[]);
    const diffed = diffCampaignTargets(snapshot, current);

    if (diffed.length === 0) {
      return Response.json({ message: "No changes — nothing to update.", diffed: [] });
    }

    const reviewCsv = toCsv(buildUpdateReviewRows(campaign.name, adGroup, diffed));
    const uploadRows = buildUpdateUploadRows(campaign.name, adGroup, diffed);

    const exportBatchId = randomUUID();
    const now = new Date();
    const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
    const basePath = `${user.id}/${datePath}/${exportBatchId}`;
    const uploadPath = `${basePath}-update-upload.xlsx`;
    const reviewPath = `${basePath}-update-review.csv`;

    try {
      const xlsxBuffer = await buildUploadXlsx(uploadRows);
      const [uploadResult, reviewResult] = await Promise.all([
        supabase.storage
          .from("bulksheets")
          .upload(uploadPath, xlsxBuffer, {
            contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }),
        supabase.storage.from("bulksheets").upload(reviewPath, reviewCsv, { contentType: "text/csv" }),
      ]);
      if (uploadResult.error) throw new Error(uploadResult.error.message);
      if (reviewResult.error) throw new Error(reviewResult.error.message);

      const { data: signedUpload } = await supabase.storage.from("bulksheets").createSignedUrl(uploadPath, 3600);

      const { error: insertTargetsError } = await supabase.from("campaign_targets").insert(
        diffed.map((t) => ({
          campaign_id: campaignId,
          user_id: user.id,
          keyword_id: t.keywordId ?? null,
          competitor_asin_id: t.competitorAsinId ?? null,
          target_text: t.text,
          match_type: t.matchType ?? null,
          targeting_expression: t.targetingExpression ?? null,
          bid: t.bid,
          state: t.state,
          operation: t.operation,
          is_negative: false,
        }))
      );
      if (insertTargetsError) throw new Error(insertTargetsError.message);

      const { data: updatedCampaign, error: flipError } = await supabase
        .from("campaigns")
        .update({
          operation: "update",
          export_batch_id: exportBatchId,
          bulksheet_path: uploadPath,
          bulksheet_download_url: signedUpload?.signedUrl ?? null,
          last_export_error: null,
          last_export_error_at: null,
        })
        .eq("id", campaignId)
        .select()
        .single();
      if (flipError) throw new Error(flipError.message);

      return Response.json({
        campaign: updatedCampaign,
        exportBatchId,
        changedCount: diffed.length,
        downloadUrl: signedUpload?.signedUrl ?? null,
      });
    } catch (uploadErr) {
      const message = uploadErr instanceof Error ? uploadErr.message : "Bulksheet upload failed";
      await supabase
        .from("campaigns")
        .update({ last_export_error: message, last_export_error_at: new Date().toISOString() })
        .eq("id", campaignId);
      return Response.json({ error: `Update Campaign failed: ${message}` }, { status: 500 });
    }
  } catch (err) {
    console.error("Error updating campaign:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
