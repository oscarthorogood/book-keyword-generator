import { randomUUID } from "node:crypto";
import { buildCampaignPlans, DEFAULT_DAILY_BUDGET_PER_CAMPAIGN, type CampaignPlan } from "@/lib/campaignBulksheetPlan";
import { buildCampaignReviewRows, buildCampaignUploadRows } from "@/lib/campaignBulksheetExport";
import { toCsv } from "@/lib/bulksheetSchema";
import { buildUploadXlsx } from "@/lib/bulksheetXlsx";
import { loadCampaignContext } from "@/lib/campaignContext";
import { marketplaceCurrency } from "@/lib/marketplaceCurrency";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { Marketplace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Decision 2 (docs/CAMPAIGNS-PROGRESS.md): typed confirmation required above this total daily spend. */
const CONFIRMATION_THRESHOLD_PER_DAY = 50;

/**
 * POST /api/books/[id]/campaigns (campaigns spec §4, PR 7)
 *
 * Body: { dailyBudgetPerCampaign?: number, includeAutoDiscovery?: boolean, confirmed?: boolean }
 *
 * Runs all five selectors (lib/campaignSelection.ts) via
 * lib/campaignBulksheetPlan.ts, builds one bulksheet across every eligible
 * sub-campaign, uploads it, and inserts campaigns/campaign_targets rows.
 * Requires `confirmed: true` once the total daily spend across all
 * campaigns exceeds $50/day (decision 2) — returns 400 with the computed
 * total instead of silently committing real budget.
 *
 * Insert-as-draft-then-flip-to-exported (spec §4 step 7): if the Storage
 * upload fails, the campaigns rows stay `draft` rather than pointing at a
 * file that doesn't exist.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const dailyBudgetPerCampaign = Number(body.dailyBudgetPerCampaign) || DEFAULT_DAILY_BUDGET_PER_CAMPAIGN;
    const includeAutoDiscovery = body.includeAutoDiscovery === true;
    const confirmed = body.confirmed === true;

    const supabase = await supabaseServer();

    const context = await loadCampaignContext(supabase, bookId, user.id);
    if (!context) return Response.json({ error: "Book not found" }, { status: 404 });
    const { book, campaignBook, bank, asinBank, siblingBooks, negatives, anchors } = context;

    const plans: CampaignPlan[] = buildCampaignPlans({
      book: campaignBook,
      bank,
      anchors,
      asinBank,
      siblingBooks,
      negatives,
      dailyBudgetPerCampaign,
      includeAutoDiscovery,
    });

    if (plans.length === 0) {
      return Response.json(
        { error: "No eligible targets for any of the five campaigns — nothing to create." },
        { status: 400 }
      );
    }

    const totalDailyBudget = Math.round(plans.reduce((sum, p) => sum + p.dailyBudget, 0) * 100) / 100;
    if (totalDailyBudget > CONFIRMATION_THRESHOLD_PER_DAY && !confirmed) {
      return Response.json(
        {
          error: `This creates ${plans.length} campaign(s) totalling ${totalDailyBudget.toFixed(2)}/day, above the ${CONFIRMATION_THRESHOLD_PER_DAY.toFixed(2)}/day confirmation threshold. Resend with confirmed: true to proceed.`,
          needsConfirmation: true,
          totalDailyBudget,
          plans: plans.map((p) => ({ campaignType: p.campaignType, name: p.name, dailyBudget: p.dailyBudget, targetCount: p.targets.length })),
        },
        { status: 400 }
      );
    }

    const exportBatchId = randomUUID();
    const currency = marketplaceCurrency(book.marketplace as Marketplace);

    const { data: insertedCampaigns, error: insertCampaignsError } = await supabase
      .from("campaigns")
      .insert(
        plans.map((plan) => ({
          user_id: user.id,
          book_id: bookId,
          export_batch_id: exportBatchId,
          campaign_type: plan.campaignType,
          name: plan.name,
          daily_budget: plan.dailyBudget,
          currency,
          status: "draft",
        }))
      )
      .select("id, campaign_type");
    if (insertCampaignsError || !insertedCampaigns) {
      return Response.json({ error: insertCampaignsError?.message ?? "Failed to create campaigns" }, { status: 400 });
    }

    const campaignIdByType = new Map(insertedCampaigns.map((c) => [c.campaign_type, c.id as string]));

    const targetRows = plans.flatMap((plan) => {
      const campaignId = campaignIdByType.get(plan.campaignType);
      const targets = plan.targets.map((t) => ({
        campaign_id: campaignId,
        user_id: user.id,
        keyword_id: t.keywordId ?? null,
        competitor_asin_id: t.competitorAsinId ?? null,
        target_text: t.text,
        match_type: t.matchType ?? null,
        targeting_expression: t.targetingExpression ?? null,
        bid: t.bid,
        state: "enabled",
        operation: "Create",
        is_negative: false,
      }));
      const negativeRows = plan.negatives.map((n) => ({
        campaign_id: campaignId,
        user_id: user.id,
        keyword_id: null,
        competitor_asin_id: null,
        target_text: n.text,
        match_type: n.matchType,
        targeting_expression: null,
        bid: null,
        state: "enabled",
        operation: "Create",
        is_negative: true,
        negative_scope: n.scope,
      }));
      return [...targets, ...negativeRows];
    });

    const { error: insertTargetsError } = await supabase.from("campaign_targets").insert(targetRows);
    if (insertTargetsError) {
      return Response.json({ error: insertTargetsError.message }, { status: 400 });
    }

    const uploadRows = buildCampaignUploadRows(plans, book.asin);
    const reviewCsv = toCsv(buildCampaignReviewRows(plans));

    const now = new Date();
    const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
    const basePath = `${user.id}/${datePath}/${exportBatchId}`;
    const uploadPath = `${basePath}-upload.xlsx`;
    const reviewPath = `${basePath}-review.csv`;

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

      const { data: exportedCampaigns, error: flipError } = await supabase
        .from("campaigns")
        .update({ status: "exported", bulksheet_path: uploadPath, bulksheet_download_url: signedUpload?.signedUrl ?? null })
        .in(
          "id",
          insertedCampaigns.map((c) => c.id)
        )
        .select();
      if (flipError) throw new Error(flipError.message);

      return Response.json({
        campaigns: exportedCampaigns,
        exportBatchId,
        totalDailyBudget,
        downloadUrl: signedUpload?.signedUrl ?? null,
      });
    } catch (uploadErr) {
      // Campaigns stay `draft` (spec §4 step 7) — no row points at a file
      // that doesn't exist. The insert already succeeded, so this is
      // recoverable: a retry re-runs Create Campaign for the same book.
      const message = uploadErr instanceof Error ? uploadErr.message : "Bulksheet upload failed";
      return Response.json(
        { error: `Campaigns created as draft, but the bulksheet upload failed: ${message}`, campaignIds: insertedCampaigns.map((c) => c.id) },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("Error creating campaigns:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
