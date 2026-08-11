import { getCompetitorAsins } from "@/lib/competitorStore";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildBulksheetCsv, type ExportKeyword } from "@/lib/bulksheet";
import type { ProductTarget } from "@/lib/productTargets";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

interface CompetitorKeywordRow {
  text: string;
  match_type: MatchType;
  bid: number | null;
  status: string;
  rejection_reason: string | null;
}

/**
 * GET /api/books/[id]/competitor-keywords/export
 *
 * Amazon Ads bulk-upload CSV for one book's competitor keywords — the
 * "Export bulksheet" action card on the Competitors tab, mirroring
 * app/api/books/[id]/keywords/export/route.ts. The book's competitor ASINs
 * (sql/15-competitor-asins.sql) double as the product-targeting list, since
 * that's exactly what they are.
 *
 * Rejected rows are never exported — they exist for review, not upload.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const includePaused = url.searchParams.get("includePaused") === "1";
    const defaultBid = Number(url.searchParams.get("defaultBid")) || 0.5;
    const dailyBudget = Number(url.searchParams.get("dailyBudget")) || 10;

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });

    const statuses = includePaused ? ["active", "paused", "negative"] : ["active", "negative"];
    const { data, error } = await supabase
      .from("competitor_keywords")
      .select("text, match_type, bid, status, rejection_reason")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", statuses);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as CompetitorKeywordRow[];
    const keywords: ExportKeyword[] = rows
      .filter((row) => row.status !== "negative")
      .map((row) => ({
        text: row.text,
        matchType: row.match_type,
        bid: row.bid,
        status: row.status,
        source: "reverse-asin",
        group: "comp-names",
      }));

    const negatives = rows
      .filter((row) => row.status === "negative")
      .map((row) => ({
        text: row.text,
        matchType: (row.match_type === "exact" ? "exact" : "phrase") as "phrase" | "exact",
        reason: row.rejection_reason ?? "",
      }));

    const competitorAsins = await getCompetitorAsins(supabase, bookId, user.id);
    const productTargets: ProductTarget[] = competitorAsins.map((asin) => ({
      asin: asin.competitor_asin,
      score: 0.5,
    }));

    const { snapshot } = loaded;
    const csv = buildBulksheetCsv({
      bookTitle: snapshot.title ?? loaded.book.title ?? snapshot.asin,
      keywords,
      negatives,
      productTargets,
      defaultBid,
      dailyBudget,
    });

    const filename = `${(snapshot.title ?? snapshot.asin).replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50)}-competitor-bulksheet.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error exporting competitor keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
