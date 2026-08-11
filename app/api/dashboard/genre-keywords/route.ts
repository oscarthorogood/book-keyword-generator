import { topKeywordsByGenre } from "@/lib/dashboardStats";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/genre-keywords
 *
 * Dashboard "Top keywords by genre" widget (Enhancements spec §2). Genre is
 * each book's own resolved primary genre (metadata_json.genreTerms[0], the
 * same vocabulary lib/genre.ts produces) — books with no resolved genre
 * (metadata unread) are silently excluded, not errored.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [{ data: books, error: booksError }, { data: keywords, error: keywordsError }] = await Promise.all([
      supabase.from("books").select("id, title, metadata_json").eq("user_id", user.id),
      supabase
        .from("keywords")
        .select("book_id, text, status, specificity")
        .eq("user_id", user.id)
        .eq("status", "active"),
    ]);

    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    if (keywordsError) return Response.json({ error: keywordsError.message }, { status: 400 });

    const bookGenreRows = (books ?? []).map((book) => {
      const snapshot = (book.metadata_json ?? {}) as { genreTerms?: string[] };
      return { id: book.id, title: book.title, genreTerms: snapshot.genreTerms ?? [] };
    });

    return Response.json({
      success: true,
      groups: topKeywordsByGenre(bookGenreRows, keywords ?? []),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
