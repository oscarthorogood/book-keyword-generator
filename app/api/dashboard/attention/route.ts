import { booksNeedingAttention } from "@/lib/dashboardStats";
import { fetchAllRows } from "@/lib/supabasePaging";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/attention
 *
 * Dashboard "Needs attention" widget: books whose capture snapshot flagged a
 * problem, books with no campaigns yet, and campaigns whose last export
 * failed. Two scoped queries, joined in lib/dashboardStats.ts rather than a
 * heavier cross-table SQL join.
 *
 * The paged read of every keyword row this used to do is gone with the
 * keyword-status reasons it fed — campaigns answer the same question far
 * more cheaply, and are what the user acts on now.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [{ data: books, error: booksError }, { data: campaigns, error: campaignsError }] =
      await Promise.all([
        fetchAllRows(
          (from, to) =>
            supabase.from("books").select("id, title, metadata_json").order("id").range(from, to),
          { label: "dashboard/attention:books" }
        ),
        // Every campaign, not just failed ones: "this book has no campaigns"
        // is decided by which book_ids appear here at all. Paged for the same
        // reason — a truncated read would invent books with no campaigns.
        fetchAllRows(
          (from, to) =>
            supabase
              .from("campaigns")
              .select("book_id, name, last_export_error")
              .order("id")
              .range(from, to),
          { label: "dashboard/attention:campaigns" }
        ),
      ]);

    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });

    return Response.json({
      success: true,
      items: booksNeedingAttention(books ?? [], campaigns ?? []),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
