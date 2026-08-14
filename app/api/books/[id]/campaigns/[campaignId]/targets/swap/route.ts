import { randomUUID } from "node:crypto";
import { buildUpdateReviewRows, buildUpdateUploadRows } from "@/lib/campaignBulksheetExport";
import type { DiffedCampaignTarget } from "@/lib/campaignDiff";
import { describeExportFailure } from "@/lib/campaignExportError";
import { toCsv } from "@/lib/bulksheetSchema";
import { buildUploadXlsx } from "@/lib/bulksheetXlsx";
import { SINGLE_AD_GROUP_LABEL, type CampaignType } from "@/lib/campaignSelection";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

interface OldTarget {
  keywordId?: string;
  competitorAsinId?: string;
  text: string;
  matchType?: MatchType;
  targetingExpression?: string;
  bid: number | null;
}

interface NewTargetEntity {
  keywordId?: string;
  competitorAsinId?: string;
  text: string;
  matchType?: MatchType;
  targetingExpression?: string;
  bid: number | null;
}

/**
 * POST /api/books/[id]/campaigns/[campaignId]/targets/swap
 *
 * Manual Update's one-target swap: archives the old keyword/ASIN and
 * creates its replacement, uploading a two-row bulksheet through the same
 * builders Automatic update (PATCH .../campaigns/[campaignId]) uses — this
 * is that route's diff-and-upload tail, just with a diff of exactly one
 * swap instead of a full re-score.
 *
 * Body: `{ old: {...}, newKeywordId }` or `{ old, newCompetitorAsinId }` to
 * swap in an existing bank entry, or `{ old, createKeyword: { text,
 * matchType, bid? } }` / `{ old, createAsin: { competitorAsin, bid? } }` to
 * add a brand-new bank entry first (spec: "if it doesn't exist a create
 * button will appear").
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; campaignId: string }> }
) {
  try {
    const { id: bookId, campaignId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id, book_id, campaign_type, name, status")
      .eq("id", campaignId)
      .eq("book_id", bookId)
      .maybeSingle();
    if (campaignError) return Response.json({ error: campaignError.message }, { status: 400 });
    if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });
    if (campaign.status !== "exported") {
      return Response.json(
        { error: "This campaign hasn't been exported yet — use Create Campaign first." },
        { status: 400 }
      );
    }

    const campaignType = campaign.campaign_type as CampaignType;
    const adGroup = SINGLE_AD_GROUP_LABEL[campaignType];
    if (!adGroup) {
      return Response.json(
        { error: "Manual update isn't supported for Auto Discovery." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const old = body.old as OldTarget | undefined;
    if (!old || typeof old.text !== "string") {
      return Response.json({ error: "Missing the target being swapped." }, { status: 400 });
    }

    let newEntity: NewTargetEntity;

    if (
      body.createKeyword &&
      typeof body.createKeyword.text === "string" &&
      body.createKeyword.text.trim()
    ) {
      const text = body.createKeyword.text.trim();
      const matchType: MatchType = ["broad", "phrase", "exact"].includes(
        body.createKeyword.matchType
      )
        ? body.createKeyword.matchType
        : "phrase";
      const bid =
        typeof body.createKeyword.bid === "number" && body.createKeyword.bid > 0
          ? body.createKeyword.bid
          : 0.5;

      const { data: existing } = await supabase
        .from("keywords")
        .select("id, text, match_type, bid")
        .eq("book_id", bookId)
        .eq("text", text)
        .eq("match_type", matchType)
        .maybeSingle();

      if (existing) {
        await supabase.from("keywords").update({ status: "active" }).eq("id", existing.id);
        newEntity = {
          keywordId: existing.id,
          text: existing.text,
          matchType: existing.match_type as MatchType,
          bid: existing.bid,
        };
      } else {
        const { data: created, error: createError } = await supabase
          .from("keywords")
          .insert({
            book_id: bookId,
            user_id: user.id,
            text,
            match_type: matchType,
            status: "active",
            bid,
            source: "manual",
          })
          .select("id, text, match_type, bid")
          .single();
        if (createError) return Response.json({ error: createError.message }, { status: 400 });
        newEntity = {
          keywordId: created.id,
          text: created.text,
          matchType: created.match_type as MatchType,
          bid: created.bid,
        };
      }
    } else if (
      body.createAsin &&
      typeof body.createAsin.competitorAsin === "string" &&
      body.createAsin.competitorAsin.trim()
    ) {
      const competitorAsin = body.createAsin.competitorAsin.trim().toUpperCase();
      const bid =
        typeof body.createAsin.bid === "number" && body.createAsin.bid > 0
          ? body.createAsin.bid
          : 0.5;

      const { data: existing } = await supabase
        .from("competitor_asins")
        .select("id, competitor_asin, bid")
        .eq("book_id", bookId)
        .eq("competitor_asin", competitorAsin)
        .maybeSingle();

      if (existing) {
        await supabase.from("competitor_asins").update({ status: "active" }).eq("id", existing.id);
        newEntity = {
          competitorAsinId: existing.id,
          text: `asin="${existing.competitor_asin}"`,
          targetingExpression: `asin="${existing.competitor_asin}"`,
          bid: existing.bid ?? bid,
        };
      } else {
        const { data: created, error: createError } = await supabase
          .from("competitor_asins")
          .insert({
            book_id: bookId,
            user_id: user.id,
            competitor_asin: competitorAsin,
            source: "manual",
            bid,
          })
          .select("id, competitor_asin, bid")
          .single();
        if (createError) return Response.json({ error: createError.message }, { status: 400 });
        newEntity = {
          competitorAsinId: created.id,
          text: `asin="${created.competitor_asin}"`,
          targetingExpression: `asin="${created.competitor_asin}"`,
          bid: created.bid,
        };
      }
    } else if (typeof body.newKeywordId === "string") {
      const { data: row, error } = await supabase
        .from("keywords")
        .select("id, text, match_type, bid")
        .eq("id", body.newKeywordId)
        .eq("book_id", bookId)
        .maybeSingle();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      if (!row)
        return Response.json({ error: "Keyword not found in this book's bank." }, { status: 404 });
      newEntity = {
        keywordId: row.id,
        text: row.text,
        matchType: row.match_type as MatchType,
        bid: row.bid,
      };
    } else if (typeof body.newCompetitorAsinId === "string") {
      const { data: row, error } = await supabase
        .from("competitor_asins")
        .select("id, competitor_asin, bid")
        .eq("id", body.newCompetitorAsinId)
        .eq("book_id", bookId)
        .maybeSingle();
      if (error) return Response.json({ error: error.message }, { status: 400 });
      if (!row)
        return Response.json({ error: "ASIN not found in this book's bank." }, { status: 404 });
      newEntity = {
        competitorAsinId: row.id,
        text: `asin="${row.competitor_asin}"`,
        targetingExpression: `asin="${row.competitor_asin}"`,
        bid: row.bid,
      };
    } else {
      return Response.json(
        { error: "Missing a replacement keyword, ASIN, or something to create." },
        { status: 400 }
      );
    }

    const diffed: DiffedCampaignTarget[] = [
      {
        keywordId: old.keywordId,
        competitorAsinId: old.competitorAsinId,
        text: old.text,
        matchType: old.matchType,
        targetingExpression: old.targetingExpression,
        bid: old.bid,
        state: "archived",
        operation: "Archive",
      },
      {
        keywordId: newEntity.keywordId,
        competitorAsinId: newEntity.competitorAsinId,
        text: newEntity.text,
        matchType: newEntity.matchType,
        targetingExpression: newEntity.targetingExpression,
        bid: newEntity.bid,
        state: "enabled",
        operation: "Create",
      },
    ];

    const reviewCsv = toCsv(buildUpdateReviewRows(campaign.name, adGroup, diffed));
    const uploadRows = buildUpdateUploadRows(campaign.name, adGroup, diffed);

    const exportBatchId = randomUUID();
    const now = new Date();
    const datePath = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
    const basePath = `${user.id}/${datePath}/${exportBatchId}`;
    const uploadPath = `${basePath}-manual-swap-upload.xlsx`;
    const reviewPath = `${basePath}-manual-swap-review.csv`;

    try {
      const xlsxBuffer = await buildUploadXlsx(uploadRows);
      const [uploadResult, reviewResult] = await Promise.all([
        supabase.storage.from("bulksheets").upload(uploadPath, xlsxBuffer, {
          contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        supabase.storage
          .from("bulksheets")
          .upload(reviewPath, reviewCsv, { contentType: "text/csv" }),
      ]);
      if (uploadResult.error) throw new Error(uploadResult.error.message);
      if (reviewResult.error) throw new Error(reviewResult.error.message);

      const { data: signedUpload } = await supabase.storage
        .from("bulksheets")
        .createSignedUrl(uploadPath, 3600);

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
        swapped: { from: old.text, to: newEntity.text },
        downloadUrl: signedUpload?.signedUrl ?? null,
      });
    } catch (uploadErr) {
      const message = describeExportFailure(
        uploadErr instanceof Error ? uploadErr.message : "Bulksheet upload failed"
      );
      await supabase
        .from("campaigns")
        .update({ last_export_error: message, last_export_error_at: new Date().toISOString() })
        .eq("id", campaignId);
      return Response.json({ error: `Manual update failed: ${message}` }, { status: 500 });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
