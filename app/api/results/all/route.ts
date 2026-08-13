import { fetchAllRows } from "@/lib/supabasePaging";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

interface ImportTotals {
  clicks: number;
  impressions: number;
  spend: number;
  sales: number;
  orders: number;
}

/**
 * GET /api/results/all
 *
 * Every Search Term Report import across every book, newest first, with the
 * performance each one carried. This is the "Results" database: one row per
 * upload, so the user can see what has been fed into campaign updates and
 * when, rather than having to open each book to find out.
 *
 * Totals are summed in TypeScript from campaign_results rather than by a
 * grouped query — PostgREST has no GROUP BY, and the alternative (a
 * server-side view) would be a schema change for a read this page can do
 * itself. Paged for the same reason keywords/all is: an unranged select
 * silently stops at PostgREST's row cap and would under-report every total.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [{ data: books, error: booksError }, { data: imports, error: importsError }] = await Promise.all([
      supabase.from("books").select("id, title, author").eq("user_id", user.id),
      supabase
        .from("result_imports")
        .select("id, book_id, source_file, report_start, report_end, row_count, matched_count, unmatched_count, status, error, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
    ]);
    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    if (importsError) return Response.json({ error: importsError.message }, { status: 400 });

    const bookById = new Map((books ?? []).map((b) => [b.id, b]));

    const { data: resultRows, error: resultsError } = await fetchAllRows(
      (from, to) =>
        supabase
          .from("campaign_results")
          .select("import_id, impressions, clicks, spend, sales, orders, currency")
          .eq("user_id", user.id)
          .order("id")
          .range(from, to),
      { label: "results/all" }
    );
    if (resultsError) return Response.json({ error: resultsError.message }, { status: 400 });

    const totalsByImport = new Map<string, ImportTotals>();
    const currencyByImport = new Map<string, string>();
    for (const row of resultRows ?? []) {
      const totals = totalsByImport.get(row.import_id) ?? { clicks: 0, impressions: 0, spend: 0, sales: 0, orders: 0 };
      totals.impressions += Number(row.impressions) || 0;
      totals.clicks += Number(row.clicks) || 0;
      totals.spend += Number(row.spend) || 0;
      totals.sales += Number(row.sales) || 0;
      totals.orders += Number(row.orders) || 0;
      totalsByImport.set(row.import_id, totals);
      if (row.currency && !currencyByImport.has(row.import_id)) currencyByImport.set(row.import_id, row.currency);
    }

    return Response.json({
      success: true,
      books: (books ?? []).map((b) => ({ id: b.id, title: b.title })),
      imports: (imports ?? [])
        // A book deleted after its import cascades the rows away, but guard
        // anyway so a stale row can't render a blank book column.
        .filter((row) => bookById.has(row.book_id))
        .map((row) => ({
          id: row.id,
          bookId: row.book_id,
          bookTitle: bookById.get(row.book_id)!.title,
          sourceFile: row.source_file,
          reportStart: row.report_start,
          reportEnd: row.report_end,
          rowCount: row.row_count,
          matchedCount: row.matched_count,
          unmatchedCount: row.unmatched_count,
          status: row.status,
          error: row.error,
          createdAt: row.created_at,
          currency: currencyByImport.get(row.id) ?? null,
          totals: totalsByImport.get(row.id) ?? { clicks: 0, impressions: 0, spend: 0, sales: 0, orders: 0 },
        })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
