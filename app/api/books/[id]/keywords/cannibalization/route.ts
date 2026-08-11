import { findCannibalizedKeywords, suggestOwner } from "@/lib/cannibalization";
import { aggregateKeywordsAcrossBooks } from "@/lib/allKeywordsAggregate";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/books/[id]/keywords/cannibalization
 *
 * Which of this book's active keywords are also active on another of the
 * user's books (Enhancements spec §14) — a callout in the book's own
 * keyword manager, alongside the global view on /keywords.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: books, error: booksError } = await supabase
      .from("books")
      .select("id, title, author")
      .eq("user_id", user.id);
    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    if (!(books ?? []).some((b) => b.id === bookId)) return Response.json({ error: "Book not found" }, { status: 404 });

    const bookById = new Map((books ?? []).map((b) => [b.id, b]));

    const { data: keywords, error: keywordsError } = await supabase
      .from("keywords")
      .select("book_id, text, status, match_type, source, specificity, bid")
      .eq("user_id", user.id)
      .eq("status", "active");
    if (keywordsError) return Response.json({ error: keywordsError.message }, { status: 400 });

    const rows = (keywords ?? [])
      .filter((k) => bookById.has(k.book_id))
      .map((k) => ({
        ...k,
        book_title: bookById.get(k.book_id)!.title,
        book_author: bookById.get(k.book_id)!.author,
      }));

    const cannibalized = findCannibalizedKeywords(aggregateKeywordsAcrossBooks(rows)).filter((row) =>
      row.books.some((b) => b.bookId === bookId && b.status === "active")
    );

    const shared = cannibalized.map((row) => ({
      text: row.text,
      otherBooks: row.books.filter((b) => b.bookId !== bookId).map((b) => ({ bookId: b.bookId, bookTitle: b.bookTitle })),
      suggestedOwnerBookId: suggestOwner(row)?.bookId ?? null,
    }));

    return Response.json({ success: true, shared });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/books/[id]/keywords/cannibalization
 *
 * "Pause in other books": body { text } pauses every other book's active
 * copy of this keyword, keeping this book's copy as the sole active owner.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return Response.json({ error: "text is required" }, { status: 400 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("keywords")
      .update({ status: "paused" })
      .eq("user_id", user.id)
      .eq("status", "active")
      .neq("book_id", bookId)
      .ilike("text", text)
      .select("id, book_id");

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true, pausedCount: data?.length ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
