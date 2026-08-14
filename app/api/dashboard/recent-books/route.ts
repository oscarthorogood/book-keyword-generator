import { recentBooksSummary } from "@/lib/dashboardStats";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/recent-books
 *
 * Dashboard "Recent books" widget (Enhancements spec §2): cover, title, and
 * a capture-health badge reused from the snapshot's own `capture.ok` /
 * `capture.completeness` fields rather than a new score.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("books")
      .select("id, title, author, created_at, metadata_json")
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ success: true, books: recentBooksSummary(data ?? [], 5) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
