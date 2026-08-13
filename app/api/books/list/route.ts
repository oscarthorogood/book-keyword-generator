import { currentUser, supabaseServer, withClockSkewRetry } from "@/lib/supabaseServer";

/**
 * GET /api/books/list
 * Get all books for the authenticated user
 */
export async function GET() {
  try {
    // Get authenticated user
    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    const { data: books, error } = await withClockSkewRetry(() =>
      supabase
        .from("books")
        .select(
          `
        id,
        asin,
        title,
        author,
        marketplace,
        total_keywords,
        created_at,
        metadata_json
      `
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
    );

    if (error) {
      console.error("Error fetching books:", error);
      return Response.json({ error: error.message }, { status: 400 });
    }

    // Campaign counts, because that's what the books list is about now.
    // books.active_campaign_count (sql/21) only counts live/paused ones, so
    // a book whose campaigns are all still `exported` would read as 0 —
    // count the rows instead. One extra query, no schema change.
    const { data: campaignRows, error: campaignsError } = await supabase
      .from("campaigns")
      .select("book_id")
      .eq("user_id", user.id);
    if (campaignsError) {
      console.error("Error fetching campaign counts:", campaignsError);
      return Response.json({ error: campaignsError.message }, { status: 400 });
    }

    const campaignCountByBook = new Map<string, number>();
    for (const row of campaignRows ?? []) {
      campaignCountByBook.set(row.book_id, (campaignCountByBook.get(row.book_id) ?? 0) + 1);
    }

    return Response.json({
      success: true,
      books: (books || []).map((book) => ({
        ...book,
        campaign_count: campaignCountByBook.get(book.id) ?? 0,
      })),
    });
  } catch (err) {
    console.error("Error in list books:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
