import { aggregateCompetitorsAcrossBooks } from "@/lib/allCompetitorsAggregate";
import { fetchAllRows } from "@/lib/supabasePaging";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/competitors/all
 *
 * Every competitor ASIN across every one of the user's books, grouped by
 * ASIN (competitor-ASIN enhancements task 3) — mirrors GET /api/keywords/all
 * exactly, for ASINs instead of keyword text. Read-only — editing still
 * happens in each book's own Competitors tab, linked to from here.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: books, error: booksError } = await supabase
      .from("books")
      .select("id, title, author")
      .eq("user_id", user.id);
    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });

    const bookById = new Map((books ?? []).map((b) => [b.id, b]));

    // Paged, mirroring GET /api/keywords/all: an unranged select would stop at
    // PostgREST's row cap and silently drop ASINs from the cross-book view.
    const { data: competitors, error: competitorsError } = await fetchAllRows(
      (from, to) =>
        supabase
          .from("competitor_asins")
          .select(
            "book_id, competitor_asin, source, status, bid, title, author, price, bsr, competitor_count, mean_rank"
          )
          .eq("user_id", user.id)
          .order("id")
          .range(from, to),
      { label: "competitors/all" }
    );
    if (competitorsError) return Response.json({ error: competitorsError.message }, { status: 400 });

    const rows = (competitors ?? [])
      .filter((c) => bookById.has(c.book_id))
      .map((c) => ({
        ...c,
        book_title: bookById.get(c.book_id)!.title,
        book_author: bookById.get(c.book_id)!.author,
      }));

    return Response.json({
      success: true,
      books: (books ?? []).map((b) => ({ id: b.id, title: b.title })),
      competitors: aggregateCompetitorsAcrossBooks(rows),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
