import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildBulksheetCsv, type BulksheetInput, type ExportKeyword } from "@/lib/bulksheet";
import { buildUploadRows } from "@/lib/bulksheetUpload";
import { buildUploadXlsx } from "@/lib/bulksheetXlsx";
import { mergeNegatives, selectApplicableNegatives, type LibraryNegativeRow } from "@/lib/negativeKeywordLibrary";
import { matchGenresToBook } from "@/lib/presetKeywords";
import { buildBrandTargets, buildProductTargets } from "@/lib/productTargets";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

/** Comp titles/authors run as their own exact-match ad group — see splitKeywordsByCategory. */
const COMP_NAME_SOURCES = new Set(["comp-name", "amazon-recs", "author-catalog", "serpapi-organic"]);

interface KeywordRow {
  text: string;
  match_type: MatchType;
  bid: number | null;
  status: string;
  source: string | null;
  rejection_reason: string | null;
}

/**
 * GET /api/books/[id]/keywords/export
 *
 * Amazon Ads bulk-upload CSV for one book: the active (and, with
 * ?includePaused=1, paused) keywords split into a descriptive campaign and a
 * comparable-titles campaign, the negative keywords, and the ASIN/brand
 * product-targeting list built from the competitor crawl.
 *
 * Rejected keywords are never exported — they exist so a human can review
 * why the pipeline dropped them, not to be uploaded.
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
      .from("keywords")
      .select("text, match_type, bid, status, source, rejection_reason")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", statuses);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const rows = (data ?? []) as KeywordRow[];
    const keywords: ExportKeyword[] = rows
      .filter((row) => row.status !== "negative")
      .map((row) => ({
        text: row.text,
        matchType: row.match_type,
        bid: row.bid,
        status: row.status,
        source: row.source,
        group: row.source && COMP_NAME_SOURCES.has(row.source) ? "comp-names" : "descriptive",
      }));

    const bookNegatives = rows
      .filter((row) => row.status === "negative")
      .map((row) => ({
        text: row.text,
        // Bulk uploads only accept negative phrase/exact; a negative broad
        // doesn't exist in Sponsored Products.
        matchType: (row.match_type === "exact" ? "exact" : "phrase") as "phrase" | "exact",
        reason: row.rejection_reason ?? "",
      }));

    const { snapshot } = loaded;

    // §15: merge in the shared negative-keyword library — global rows
    // always, genre rows when this book's resolved genre matches, book
    // rows for this exact book. Fails soft to just the book's own
    // negatives on a database that hasn't run sql/12 yet.
    const [{ data: libraryRows, error: libraryError }, { data: genreRows, error: genreError }] = await Promise.all([
      supabase
        .from("negative_keywords")
        .select("keyword, match_type, scope, genre_id, book_id, reason")
        .eq("user_id", user.id),
      supabase.from("preset_genres").select("id, name, parent_id").eq("user_id", user.id),
    ]);

    let negatives = bookNegatives;
    if (!libraryError && !genreError && libraryRows) {
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
    const bulksheetInput: BulksheetInput = {
      bookTitle: snapshot.title ?? loaded.book.title ?? snapshot.asin,
      sku: loaded.book.asin,
      keywords,
      negatives,
      productTargets: buildProductTargets(snapshot.competitors, snapshot.compAsins),
      brandTargets: buildBrandTargets(snapshot.competitors),
      defaultBid,
      dailyBudget,
    };

    const baseFilename = (snapshot.title ?? snapshot.asin).replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 50);

    // UI copy stays "Download campaign plan" until PR 3.5's human upload gate
    // confirms this format is actually accepted by Amazon.
    if (url.searchParams.get("format") === "upload") {
      const xlsx = await buildUploadXlsx(buildUploadRows(bulksheetInput));
      return new Response(new Uint8Array(xlsx), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="${baseFilename}-upload.xlsx"`,
          "Cache-Control": "no-store",
        },
      });
    }

    const csv = buildBulksheetCsv(bulksheetInput);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${baseFilename}-review.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error exporting keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
