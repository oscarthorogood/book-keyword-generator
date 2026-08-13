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

    return Response.json({
      success: true,
      books: books || [],
    });
  } catch (err) {
    console.error("Error in list books:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
