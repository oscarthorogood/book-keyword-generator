import { createClient } from "@supabase/supabase-js";

/**
 * GET /api/books/list
 * Get all books for the authenticated user
 */
export async function GET(request: Request) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    // Placeholder user ID
    const userId = "placeholder-user-id";

    const { data: books, error } = await supabase
      .from("books")
      .select(
        `
        id,
        asin,
        title,
        author,
        marketplace,
        campaign_count,
        total_keywords,
        created_at,
        metadata_json
      `
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

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
