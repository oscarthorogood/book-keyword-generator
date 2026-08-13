import { booksNeedingAttention } from "@/lib/dashboardStats";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/attention
 *
 * Dashboard "Needs attention" widget: books whose capture snapshot flagged a
 * problem, books with keywords but none `active`, and campaigns whose last
 * export failed. Three cheap scoped queries, joined in lib/dashboardStats.ts
 * rather than a heavier cross-table SQL join.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [
      { data: books, error: booksError },
      { data: keywordRows, error: keywordsError },
      { data: campaigns, error: campaignsError },
    ] = await Promise.all([
      supabase.from("books").select("id, title, total_keywords, metadata_json").eq("user_id", user.id),
      supabase.from("keywords").select("book_id, status").eq("user_id", user.id),
      supabase
        .from("campaigns")
        .select("book_id, name, last_export_error")
        .eq("user_id", user.id)
        .not("last_export_error", "is", null),
    ]);

    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    if (keywordsError) return Response.json({ error: keywordsError.message }, { status: 400 });
    if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });

    return Response.json({
      success: true,
      items: booksNeedingAttention(books ?? [], keywordRows ?? [], campaigns ?? []),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
