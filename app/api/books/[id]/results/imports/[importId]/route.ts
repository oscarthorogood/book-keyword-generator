import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/books/[id]/results/imports/[importId] (campaigns spec §5/§7)
 *
 * Returns one result_imports row. The import route (PR 8b) processes
 * synchronously and this app has no background-task infrastructure, so in
 * practice this always sees 'complete'/'failed' rather than 'processing' —
 * it's kept for import history and status display, not because the import
 * route leaves work outstanding after responding.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; importId: string }> }) {
  try {
    const { id: bookId, importId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("result_imports")
      .select("*")
      .eq("id", importId)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    if (!data) return Response.json({ error: "Import not found" }, { status: 404 });

    return Response.json({ import: data });
  } catch (err) {
    console.error("Error fetching import status:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
