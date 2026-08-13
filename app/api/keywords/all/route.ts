import { aggregateKeywordsAcrossBooks } from "@/lib/allKeywordsAggregate";
import { fetchAllRows } from "@/lib/supabasePaging";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/keywords/all
 *
 * Every keyword across every one of the user's books, grouped by text
 * (Enhancements spec §4). Read-only — editing still happens in each book's
 * own keyword manager, linked to from here.
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

    // Paged: this is every keyword across every book, which is the largest
    // read in the app. An unranged select would silently stop at PostgREST's
    // row cap and quietly drop keywords from the view.
    const { data: keywords, error: keywordsError } = await fetchAllRows(
      (from, to) =>
        supabase
          .from("keywords")
          .select("book_id, text, status, match_type, source, specificity, bid")
          .eq("user_id", user.id)
          .neq("status", "negative")
          .order("id")
          .range(from, to),
      { label: "keywords/all" }
    );
    if (keywordsError) return Response.json({ error: keywordsError.message }, { status: 400 });

    const rows = (keywords ?? [])
      .filter((k) => bookById.has(k.book_id))
      .map((k) => ({
        ...k,
        book_title: bookById.get(k.book_id)!.title,
        book_author: bookById.get(k.book_id)!.author,
      }));

    return Response.json({
      success: true,
      books: (books ?? []).map((b) => ({ id: b.id, title: b.title })),
      keywords: aggregateKeywordsAcrossBooks(rows),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
