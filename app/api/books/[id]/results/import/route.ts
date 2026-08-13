import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { mapWithConcurrency } from "@/lib/concurrency";
import { parseCsv } from "@/lib/csv";
import { marketplaceCurrency } from "@/lib/marketplaceCurrency";
import { aggregateByTarget, matchResultRows, type MatchContext } from "@/lib/resultsMatching";
import { parseSearchTermReportRows } from "@/lib/searchTermImport";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { normalizeKeyword } from "@/lib/keywordFilters";
import type { Marketplace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const CAMPAIGN_RESULTS_UPSERT_CONFLICT = "book_id,campaign_name,ad_group_name,keyword_text,match_type,report_start,report_end";
const CAMPAIGN_RESULTS_BATCH_SIZE = 500;

/**
 * POST /api/books/[id]/results/import (campaigns spec §5, PR 8b)
 *
 * Body: multipart/form-data with `file` (the Search Term Report CSV) and
 * `reportStart` / `reportEnd` (YYYY-MM-DD).
 *
 * Processed synchronously within one request, same pattern as every other
 * long-running route in this app (maxDuration=60) — the spec's "insert as
 * processing, return immediately, process in background, poll for status"
 * assumes queue/background-task infrastructure this codebase doesn't have.
 * result_imports is written 'complete'/'failed' before responding; the
 * poll route (GET .../imports/[importId]) still exists for history/status
 * display, not because this route leaves work outstanding.
 *
 * Report period is always required from the caller — Amazon's Search Term
 * Report CSV doesn't reliably carry a per-row date range in a form safe to
 * derive report_start/report_end from, so "derive from the file" isn't
 * attempted here (a narrower scope than the spec's §5 step 3).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id, marketplace")
      .eq("id", bookId)
      .eq("user_id", user.id)
      .single();
    if (bookError || !book) return Response.json({ error: "Book not found" }, { status: 404 });

    const formData = await request.formData().catch(() => null);
    const file = formData?.get("file");
    const reportStart = formData?.get("reportStart");
    const reportEnd = formData?.get("reportEnd");

    if (!(file instanceof File)) {
      return Response.json({ error: "file is required (multipart/form-data)" }, { status: 400 });
    }
    if (typeof reportStart !== "string" || !reportStart || typeof reportEnd !== "string" || !reportEnd) {
      return Response.json({ error: "reportStart and reportEnd (YYYY-MM-DD) are required" }, { status: 400 });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const text = new TextDecoder("utf-8").decode(bytes);

    const { data: existingImport } = await supabase
      .from("result_imports")
      .select("id, created_at")
      .eq("book_id", bookId)
      .eq("file_hash", fileHash)
      .maybeSingle();
    if (existingImport) {
      return Response.json(
        { error: "This exact file was already imported for this book.", importId: existingImport.id },
        { status: 409 }
      );
    }

    const { data: importRow, error: insertImportError } = await supabase
      .from("result_imports")
      .insert({
        user_id: user.id,
        book_id: bookId,
        source_file: file.name,
        file_hash: fileHash,
        report_start: reportStart,
        report_end: reportEnd,
        status: "processing",
      })
      .select("id")
      .single();
    if (insertImportError || !importRow) {
      return Response.json({ error: insertImportError?.message ?? "Failed to start import" }, { status: 400 });
    }
    const importId: string = importRow.id;

    try {
      const rawRows = parseCsv(text);
      const reportRows = parseSearchTermReportRows(rawRows);
      const aggregated = aggregateByTarget(reportRows);

      const [{ data: keywordRows }, { data: asinRows }, { data: campaignRows }] = await Promise.all([
        supabase.from("keywords").select("id, text, match_type").eq("book_id", bookId).eq("user_id", user.id),
        supabase.from("competitor_asins").select("id, competitor_asin").eq("book_id", bookId).eq("user_id", user.id),
        supabase.from("campaigns").select("id, name").eq("book_id", bookId).eq("user_id", user.id),
      ]);

      const context: MatchContext = {
        keywordsByTextAndMatchType: new Map(
          (keywordRows ?? []).map((k) => [`${normalizeKeyword(k.text)}::${k.match_type}`, k.id as string])
        ),
        competitorAsinsByAsin: new Map((asinRows ?? []).map((a) => [a.competitor_asin.toUpperCase(), a.id as string])),
        campaignsByName: new Map((campaignRows ?? []).map((c) => [c.name, c.id as string])),
      };

      const { matched, unmatchedCount } = matchResultRows(aggregated, context);

      const currency = marketplaceCurrency(book.marketplace as Marketplace);
      const dbRows = matched.map((row) => ({
        user_id: user.id,
        book_id: bookId,
        import_id: importId,
        campaign_id: row.campaignId,
        keyword_id: row.keywordId,
        competitor_asin_id: row.competitorAsinId,
        campaign_name: row.campaignName ?? "",
        ad_group_name: row.adGroupName ?? "",
        keyword_text: row.targeting ?? "",
        match_type: row.matchType ?? "",
        targeting_expression: row.competitorAsinId ? row.targeting : null,
        report_start: reportStart,
        report_end: reportEnd,
        impressions: row.impressions,
        clicks: row.clicks,
        spend: row.spend,
        sales: row.sales,
        orders: row.orders,
        currency,
        source_file: file.name,
      }));

      for (let i = 0; i < dbRows.length; i += CAMPAIGN_RESULTS_BATCH_SIZE) {
        const batch = dbRows.slice(i, i + CAMPAIGN_RESULTS_BATCH_SIZE);
        const { error: upsertError } = await supabase
          .from("campaign_results")
          .upsert(batch, { onConflict: CAMPAIGN_RESULTS_UPSERT_CONFLICT });
        if (upsertError) throw new Error(upsertError.message);
      }

      await refreshLastPeriodCache(supabase, matched);

      const { data: completedImport, error: completeError } = await supabase
        .from("result_imports")
        .update({
          status: "complete",
          row_count: reportRows.length,
          matched_count: matched.length - unmatchedCount,
          unmatched_count: unmatchedCount,
        })
        .eq("id", importId)
        .select()
        .single();
      if (completeError) throw new Error(completeError.message);

      return Response.json({ import: completedImport });
    } catch (processingError) {
      const message = processingError instanceof Error ? processingError.message : "Unknown error";
      await supabase.from("result_imports").update({ status: "failed", error: message }).eq("id", importId);
      return Response.json({ error: message, importId }, { status: 500 });
    }
  } catch (err) {
    console.error("Error importing results:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

const RESULT_CACHE_CONCURRENCY = 8;

interface EntitySums {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

/**
 * Refreshes the last_* denormalised cache (sql/24) on every keyword/ASIN
 * this import touched. Sums per entity first since one report can carry
 * several aggregated rows resolving to the same keyword (e.g. it appears
 * in more than one ad group) — writing once per entity, not once per row.
 *
 * Each entity needs its own UPDATE (distinct values per row, keyed by id),
 * so the row count here scales with the report. Those updates are therefore
 * bounded by RESULT_CACHE_CONCURRENCY rather than dispatched all at once: a
 * Search Term Report covering a few thousand keywords previously opened a
 * request per keyword simultaneously, which exhausts the PostgREST
 * connection pool and gets the tail of the batch rejected.
 *
 * Failures here are logged and counted, not thrown. campaign_results has
 * already been committed by this point, so the import genuinely succeeded —
 * losing a denormalised cache refresh must not flip it to 'failed' and tell
 * the user to re-upload a file that landed correctly. The cache is rebuilt
 * by the next import that touches the same entity.
 */
async function refreshLastPeriodCache(
  supabase: SupabaseClient,
  matched: Array<{
    keywordId: string | null;
    competitorAsinId: string | null;
    impressions: number;
    clicks: number;
    spend: number;
    sales: number;
    orders: number;
  }>
): Promise<void> {
  const nowIso = new Date().toISOString();

  const sumsByEntity = (idKey: "keywordId" | "competitorAsinId") => {
    const sums = new Map<string, EntitySums>();
    for (const row of matched) {
      const id = row[idKey];
      if (!id) continue;
      const existing = sums.get(id) ?? { impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
      existing.impressions += row.impressions;
      existing.clicks += row.clicks;
      existing.spend += row.spend;
      existing.sales += row.sales;
      existing.orders += row.orders;
      sums.set(id, existing);
    }
    return sums;
  };

  const keywordSums = sumsByEntity("keywordId");
  const asinSums = sumsByEntity("competitorAsinId");

  const updates: Array<{ table: "keywords" | "competitor_asins"; id: string; sums: EntitySums }> = [
    ...Array.from(keywordSums.entries()).map(
      ([id, sums]) => ({ table: "keywords" as const, id, sums })
    ),
    ...Array.from(asinSums.entries()).map(
      ([id, sums]) => ({ table: "competitor_asins" as const, id, sums })
    ),
  ];

  const failures = await mapWithConcurrency(
    updates,
    RESULT_CACHE_CONCURRENCY,
    async ({ table, id, sums }): Promise<number> => {
      try {
        const { error } = await supabase
          .from(table)
          .update({
            last_impressions: sums.impressions,
            last_clicks: sums.clicks,
            last_spend: sums.spend,
            last_sales: sums.sales,
            last_orders: sums.orders,
            results_updated_at: nowIso,
          })
          .eq("id", id);
        // Previously discarded: a rejected update left the cache silently
        // stale with nothing in the logs to explain the drift.
        if (error) {
          console.error(
            `[results-import] cache refresh failed for ${table} ${id}: ${error.message}`
          );
          return 1;
        }
        return 0;
      } catch (err) {
        console.error(
          `[results-import] cache refresh threw for ${table} ${id}:`,
          err instanceof Error ? err.message : err
        );
        return 1;
      }
    }
  );

  const failedCount = failures.reduce((sum, n) => sum + n, 0);
  if (failedCount > 0) {
    console.error(
      `[results-import] ${failedCount}/${updates.length} last_* cache updates failed; ` +
        "campaign_results were still written and the import stands."
    );
  }
}
