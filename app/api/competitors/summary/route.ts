import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

interface BookCompetitorSummary {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  competitorAsinCount: number;
  competitorKeywordCount: number;
}

/**
 * GET /api/competitors/summary
 *
 * Per-book competitor stats for the global /competitors page (spec §5.2):
 * how many competitor ASINs are attached to each book and how many
 * competitor keywords have been imported for it. Read-only — the per-book
 * competitor panel (BookKeywordPanel mode="competitors") is where the data
 * is actually managed.
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

    const [{ data: asinRows, error: asinError }, { data: keywordRows, error: keywordError }] = await Promise.all([
      supabase.from("competitor_asins").select("book_id").eq("user_id", user.id),
      supabase.from("competitor_keywords").select("book_id").eq("user_id", user.id),
    ]);
    if (asinError) return Response.json({ error: asinError.message }, { status: 400 });
    if (keywordError) return Response.json({ error: keywordError.message }, { status: 400 });

    const asinCountByBook = new Map<string, number>();
    for (const row of asinRows ?? []) asinCountByBook.set(row.book_id, (asinCountByBook.get(row.book_id) ?? 0) + 1);

    const keywordCountByBook = new Map<string, number>();
    for (const row of keywordRows ?? []) {
      keywordCountByBook.set(row.book_id, (keywordCountByBook.get(row.book_id) ?? 0) + 1);
    }

    const summary: BookCompetitorSummary[] = (books ?? []).map((book) => ({
      bookId: book.id,
      bookTitle: book.title,
      bookAuthor: book.author,
      competitorAsinCount: asinCountByBook.get(book.id) ?? 0,
      competitorKeywordCount: keywordCountByBook.get(book.id) ?? 0,
    }));

    return Response.json({ success: true, books: summary });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
