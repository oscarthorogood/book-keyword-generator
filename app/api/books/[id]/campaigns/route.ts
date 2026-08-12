import { randomUUID } from "node:crypto";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildCampaignPlans, DEFAULT_DAILY_BUDGET_PER_CAMPAIGN, type CampaignPlan } from "@/lib/campaignBulksheetPlan";
import { buildCampaignReviewRows, buildCampaignUploadRows } from "@/lib/campaignBulksheetExport";
import { toCsv } from "@/lib/bulksheetSchema";
import { buildUploadXlsx } from "@/lib/bulksheetXlsx";
import { buildBookAnchors } from "@/lib/keywordAnchors";
import { marketplaceCurrency } from "@/lib/marketplaceCurrency";
import { mergeNegatives, selectApplicableNegatives, type LibraryNegativeRow } from "@/lib/negativeKeywordLibrary";
import type { NegativeKeyword } from "@/lib/negativeKeywords";
import { matchGenresToBook } from "@/lib/presetKeywords";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { CampaignBook, KeywordWithRollups } from "@/lib/campaignSelection";
import type { CompetitorAsin, KeywordSource, Marketplace, MatchType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Decision 2 (docs/CAMPAIGNS-PROGRESS.md): typed confirmation required above this total daily spend. */
const CONFIRMATION_THRESHOLD_PER_DAY = 50;

interface KeywordRow {
  id: string;
  text: string;
  match_type: MatchType;
  status: string;
  bid: number | null;
  specificity: number | null;
  source: string | null;
  rejection_reason: string | null;
}

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  status: string;
  bid: number | null;
  price: number | null;
  bsr: number | null;
  mean_rank: number | null;
  relationship: string | null;
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

    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });
    const { book, snapshot } = loaded;

    const campaignBook: CampaignBook = {
      id: book.id,
      author: book.author,
      title: book.title,
      series_key: book.series_key ?? null,
      asin: book.asin,
    };

    const [{ data: keywordRows }, { data: asinRows }, { data: siblingRows }, { data: libraryRows }, { data: genreRows }] =
      await Promise.all([
        supabase
          .from("keywords")
          .select("id, text, match_type, status, bid, specificity, source, rejection_reason")
          .eq("book_id", bookId)
          .eq("user_id", user.id)
          .in("status", ["active", "paused", "negative"]),
        supabase
          .from("competitor_asins")
          .select("id, competitor_asin, status, bid, price, bsr, mean_rank, relationship")
          .eq("book_id", bookId)
          .eq("user_id", user.id)
          .in("status", ["active", "paused"]),
        campaignBook.series_key
          ? supabase.from("books").select("id, author, title, series_key, asin").eq("user_id", user.id).eq("series_key", campaignBook.series_key)
          : Promise.resolve({ data: [] as CampaignBook[] }),
        supabase.from("negative_keywords").select("keyword, match_type, scope, genre_id, book_id, reason").eq("user_id", user.id),
        supabase.from("preset_genres").select("id, name, parent_id").eq("user_id", user.id),
      ]);

    const activeKeywords = (keywordRows ?? []).filter((r): r is KeywordRow => r.status !== "negative");
    const bank: KeywordWithRollups[] = activeKeywords.map((row) => ({
      id: row.id,
      text: row.text,
      sources: row.source ? [row.source as KeywordSource] : [],
      matchType: row.match_type,
      specificity: row.specificity ?? undefined,
      status: row.status as KeywordWithRollups["status"],
      bid: row.bid,
    }));

    if (bank.length > 0) {
      const { data: rollups } = await supabase
        .from("keyword_result_rollups")
        .select("keyword_id, lifetime_orders")
        .in(
          "keyword_id",
          bank.map((k) => k.id)
        );
      const ordersByKeywordId = new Map((rollups ?? []).map((r) => [r.keyword_id as string, r.lifetime_orders as number | null]));
      for (const keyword of bank) {
        keyword.lifetimeOrders = ordersByKeywordId.get(keyword.id) ?? undefined;
      }
    }

    const asinBank: CompetitorAsin[] = ((asinRows ?? []) as CompetitorAsinRow[]).map((row) => ({
      id: row.id,
      book_id: bookId,
      competitor_asin: row.competitor_asin,
      source: "manual",
      notes: null,
      status: row.status as CompetitorAsin["status"],
      bid: row.bid,
      rejection_reason: null,
      rejected_by_filter: null,
      title: null,
      author: null,
      price: row.price,
      bsr: row.bsr,
      competitor_count: null,
      mean_rank: row.mean_rank,
      created_at: "",
      updated_at: "",
      relationship: (row.relationship ?? "rival") as CompetitorAsin["relationship"],
    }));

    const siblingBooks: CampaignBook[] = ((siblingRows ?? []) as CampaignBook[]).filter((b) => b.id !== campaignBook.id);

    // Same starter + library negative merge as app/api/books/[id]/keywords/export/route.ts.
    const bookNegatives: NegativeKeyword[] = (keywordRows ?? [])
      .filter((row) => row.status === "negative")
      .map((row) => ({
        text: row.text,
        matchType: (row.match_type === "exact" ? "exact" : "phrase") as "phrase" | "exact",
        reason: row.rejection_reason ?? "",
      }));
    let negatives = bookNegatives;
    if (libraryRows) {
      const genres = (genreRows ?? []).map((g) => ({ id: g.id, name: g.name, parentId: g.parent_id }));
      const matchedGenreIds = new Set(matchGenresToBook(genres, snapshot.genreTerms).map((g) => g.id));
      const applicable: LibraryNegativeRow[] = libraryRows.map((row) => ({
        keyword: row.keyword,
        matchType: row.match_type as "phrase" | "exact",
        scope: row.scope as LibraryNegativeRow["scope"],
        genreId: row.genre_id,
        bookId: row.book_id,
        reason: row.reason,
      }));
      negatives = mergeNegatives(bookNegatives, selectApplicableNegatives(applicable, bookId, matchedGenreIds));
    }

    const anchors = buildBookAnchors({
      title: snapshot.title,
      asin: snapshot.asin,
      author: snapshot.author,
      seriesName: snapshot.seriesName,
      description: snapshot.description,
      genreTerms: snapshot.genreTerms,
      genreFamilies: snapshot.genreFamilies,
      categoryPath: snapshot.categoryPath,
      categories: snapshot.categories,
      goodreadsTags: snapshot.goodreadsTags,
      competitors: snapshot.competitors,
      compTitles: snapshot.compTitles,
      reviewSnippets: snapshot.reviewSnippets,
    });

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
