import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * GET /api/books/[id]
 * Get a specific book with all its campaigns
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get authenticated user
    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    // Get book with campaigns
    const { data: book, error: bookError } = await supabase
      .from("books")
      .select(
        `
        id,
        asin,
        title,
        author,
        marketplace,
        description,
        campaign_count,
        total_keywords,
        total_spend,
        created_at,
        metadata_json,
        campaigns (
          id,
          name,
          status,
          tropes_keyword_count,
          comp_names_keyword_count,
          product_target_count,
          total_rows,
          daily_budget,
          created_at
        )
      `
      )
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) {
      return Response.json(
        { error: "Book not found" },
        { status: 404 }
      );
    }

    return Response.json({
      success: true,
      book,
    });
  } catch (err) {
    console.error("Error in get book:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
