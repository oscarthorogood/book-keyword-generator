import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildBulksheetCsv } from "@/lib/bulksheet";
import type { ProductTarget } from "@/lib/productTargets";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

interface CompetitorAsinRow {
  competitor_asin: string;
  bid: number | null;
  status: string;
}

/**
 * GET /api/books/[id]/competitors/export
 *
 * Amazon Ads bulk-upload CSV of this book's competitor ASINs as product
 * targets — the "Export bulksheet" action card on the Competitors tab,
 * mirroring app/api/books/[id]/keywords/export/route.ts. No keyword rows:
 * the Competitors tab manages ASINs only.
 *
 * Rejected ASINs are never exported — they exist for review, not upload.
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

    const statuses = includePaused ? ["active", "paused"] : ["active"];
    const { data, error } = await supabase
      .from("competitor_asins")
      .select("competitor_asin, bid, status")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", statuses);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as CompetitorAsinRow[];
    const productTargets: ProductTarget[] = rows.map((row) => ({
      asin: row.competitor_asin,
      score: row.bid ?? 0.5,
    }));

    const { snapshot } = loaded;
    const csv = buildBulksheetCsv({
      bookTitle: snapshot.title ?? loaded.book.title ?? snapshot.asin,
      keywords: [],
      productTargets,
      defaultBid,
      dailyBudget,
    });

    const filename = `${(snapshot.title ?? snapshot.asin).replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50)}-competitor-asins-bulksheet.csv`;

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error exporting competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
