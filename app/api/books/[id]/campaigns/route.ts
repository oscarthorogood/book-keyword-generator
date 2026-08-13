import { randomUUID } from "node:crypto";
import { buildCampaignPlans, DEFAULT_DAILY_BUDGET_PER_CAMPAIGN, type CampaignPlan } from "@/lib/campaignBulksheetPlan";
import { buildCampaignReviewRows, buildCampaignUploadRows } from "@/lib/campaignBulksheetExport";
import { toCsv } from "@/lib/bulksheetSchema";
import { describeExportFailure } from "@/lib/campaignExportError";
import { buildUploadXlsx } from "@/lib/bulksheetXlsx";
import { loadCampaignContext } from "@/lib/campaignContext";
import { describePrepare, prepareBank, type PrepareBankResult } from "@/lib/campaignPrepare";
import type { KeywordWithRollups } from "@/lib/campaignSelection";
import { marketplaceCurrency } from "@/lib/marketplaceCurrency";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { CompetitorAsin, Marketplace } from "@/lib/types";

export const runtime = "nodejs";
// Create Campaigns now runs the whole generate → filter pipeline inline when
// a book's bank is empty (lib/campaignPrepare.ts), so this request can take
// as long as the old Generate button did plus selection on top — 60s is no
// longer enough headroom.
export const maxDuration = 300;

/** Decision 2 (docs/CAMPAIGNS-PROGRESS.md): typed confirmation required above this total daily spend. */
const CONFIRMATION_THRESHOLD_PER_DAY = 50;

/**
 * Explains an empty plan set in terms of what the user can actually do.
 *
 * The book page no longer has bank buttons to point at — Create Campaigns
 * runs generation and filtering itself (lib/campaignPrepare.ts) — so this
 * reports what the automatic pass found rather than instructing the user to
 * press controls that no longer exist. The archived-count query only fires
 * on this failure path, never on the common success path.
 */
async function noEligibleTargetsMessage(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  bookId: string,
  userId: string,
  bank: KeywordWithRollups[],
  asinBank: CompetitorAsin[],
  prepare: PrepareBankResult
): Promise<string> {
  const base = "No eligible targets for any of the five campaigns — nothing to create.";
  // Whatever went wrong upstream is the most useful thing we can say; a
  // failed capture or a dead keyword source is the real cause here, not the
  // selection rules.
  const because = prepare.warnings.length > 0 ? ` ${prepare.warnings.join(" ")}` : "";

  if (bank.length > 0 || asinBank.length > 0) {
    return (
      `${base} This book has ${bank.length} keyword(s) and ${asinBank.length} ASIN(s) ready, but none matched a ` +
      "campaign's targeting rules (for example: no exact-match keywords for Alpha Exact, or no other books in the " +
      `series for Catalog Cross-Sell).${because}`
    );
  }

  const [{ count: archivedKeywordCount }, { count: archivedAsinCount }] = await Promise.all([
    supabase.from("keywords").select("id", { count: "exact", head: true }).eq("book_id", bookId).eq("user_id", userId).eq("status", "archived"),
    supabase.from("competitor_asins").select("id", { count: "exact", head: true }).eq("book_id", bookId).eq("user_id", userId).eq("status", "archived"),
  ]);

  if ((archivedKeywordCount ?? 0) > 0 || (archivedAsinCount ?? 0) > 0) {
    return (
      `${base} This book has ${archivedKeywordCount ?? 0} keyword(s) and ${archivedAsinCount ?? 0} ASIN(s), but the ` +
      `filters rejected all of them as too broad or off-target for this listing.${because}`
    );
  }

  return `${base} Nothing could be generated for this book — check that its Amazon metadata was captured.${because}`;
}

/** GET /api/books/[id]/campaigns — this book's sub-campaigns, for the Create/Update Campaign action row and the "needs Amazon ID" badge. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookId } = await params;

  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("campaigns")
    .select(
      "id, campaign_type, name, daily_budget, status, amazon_campaign_id, export_batch_id, updated_at, bulksheet_path, last_export_error, last_export_error_at"
    )
    .eq("book_id", bookId)
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ campaigns: data ?? [] });
}

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

    // The one press the book page offers has to do the whole job: if this
    // book has no campaign-eligible targets yet, generate and filter them
    // now. No-ops when the bank is already populated, which is what keeps
    // the `confirmed: true` round-trip below from generating twice.
    const prepare = await prepareBank(supabase, bookId, user.id);

    const context = await loadCampaignContext(supabase, bookId, user.id);
    if (!context) return Response.json({ error: "Book not found" }, { status: 404 });
    const { book, campaignBook, bank, asinBank, siblingBooks, negatives, anchors } = context;

    const plans: CampaignPlan[] = await buildCampaignPlans({
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
        { error: await noEligibleTargetsMessage(supabase, bookId, user.id, bank, asinBank, prepare) },
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

    // Retry path. When the bulksheet upload below fails, the campaigns rows
    // stay `draft` (spec §4 step 7) — but `campaigns_unique_name_per_user`
    // (sql/21) means a plain re-insert on the next attempt dies on a duplicate
    // name, and "Filter & update campaign" only accepts `exported` campaigns.
    // That left a failed export with no way forward from either button. Reuse
    // the leftover drafts instead, so Create Campaigns is the retry.
    const { data: sameNameCampaigns, error: sameNameError } = await supabase
      .from("campaigns")
      .select("id, name, status, book_id")
      .eq("user_id", user.id)
      .in(
        "name",
        plans.map((plan) => plan.name)
      );
    if (sameNameError) return Response.json({ error: sameNameError.message }, { status: 400 });

    const reusableIdByName = new Map<string, string>();
    for (const row of sameNameCampaigns ?? []) {
      if (row.book_id !== bookId) {
        return Response.json(
          { error: `A campaign named "${row.name}" already exists on another book — rename it before creating campaigns here.` },
          { status: 409 }
        );
      }
      if (row.status !== "draft") {
        return Response.json(
          {
            error: `This book's campaigns already exist ("${row.name}" is ${row.status}) — use "Filter & update campaign" to refresh them instead of creating them again.`,
          },
          { status: 409 }
        );
      }
      reusableIdByName.set(row.name as string, row.id as string);
    }

    const campaignIdByType = new Map<string, string>();

    for (const plan of plans.filter((p) => reusableIdByName.has(p.name))) {
      const id = reusableIdByName.get(plan.name)!;
      const { error: refreshError } = await supabase
        .from("campaigns")
        .update({
          export_batch_id: exportBatchId,
          campaign_type: plan.campaignType,
          daily_budget: plan.dailyBudget,
          currency,
          status: "draft",
        })
        .eq("id", id)
        .eq("user_id", user.id);
      if (refreshError) return Response.json({ error: refreshError.message }, { status: 400 });
      campaignIdByType.set(plan.campaignType, id);
    }

    // The failed run already wrote this campaign's targets; without clearing
    // them the retry's insert would double every row.
    if (reusableIdByName.size > 0) {
      const { error: clearTargetsError } = await supabase
        .from("campaign_targets")
        .delete()
        .in("campaign_id", [...reusableIdByName.values()])
        .eq("user_id", user.id);
      if (clearTargetsError) return Response.json({ error: clearTargetsError.message }, { status: 400 });
    }

    const plansToInsert = plans.filter((p) => !reusableIdByName.has(p.name));
    if (plansToInsert.length > 0) {
      const { data: insertedCampaigns, error: insertCampaignsError } = await supabase
        .from("campaigns")
        .insert(
          plansToInsert.map((plan) => ({
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
      for (const c of insertedCampaigns) campaignIdByType.set(c.campaign_type as string, c.id as string);
    }

    const campaignIds = [...campaignIdByType.values()];

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
        .update({
          status: "exported",
          bulksheet_path: uploadPath,
          bulksheet_download_url: signedUpload?.signedUrl ?? null,
          last_export_error: null,
          last_export_error_at: null,
        })
        .in("id", campaignIds)
        .select();
      if (flipError) throw new Error(flipError.message);

      return Response.json({
        campaigns: exportedCampaigns,
        exportBatchId,
        totalDailyBudget,
        downloadUrl: signedUpload?.signedUrl ?? null,
        // What the automatic bank pass did, if anything, plus any pipeline
        // that failed without stopping the campaigns from being built —
        // the UI shows this so a partial run never looks like a clean one.
        prepared: describePrepare(prepare),
        warnings: prepare.warnings,
      });
    } catch (uploadErr) {
      // Campaigns stay `draft` (spec §4 step 7) — no row points at a file
      // that doesn't exist. The insert already succeeded, so this is
      // recoverable: a retry re-runs Create Campaigns for the same book and
      // picks these drafts back up.
      const message = describeExportFailure(uploadErr instanceof Error ? uploadErr.message : "Bulksheet upload failed");
      await supabase
        .from("campaigns")
        .update({ last_export_error: message, last_export_error_at: new Date().toISOString() })
        .in("id", campaignIds);
      return Response.json({ error: `Campaigns created as draft, but the bulksheet upload failed: ${message}`, campaignIds }, { status: 500 });
    }
  } catch (err) {
    console.error("Error creating campaigns:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
