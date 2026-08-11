import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/filter-allowlist — the user's whole allowlist.
 *
 * POST /api/filter-allowlist — restore a rejected/paused keyword and add
 * it to the allowlist so no future generate run rejects that exact text
 * again. Body: `{ text, filter?, note? }`.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("filter_allowlist")
      .select("id, keyword_text, original_filter, note, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      if (/relation .*filter_allowlist.* does not exist/i.test(error.message)) {
        return Response.json({ success: true, allowlist: [], needsMigration: true });
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ success: true, allowlist: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) return Response.json({ error: "text is required" }, { status: 400 });
    const filter = typeof body.filter === "string" ? body.filter : null;
    const note = typeof body.note === "string" ? body.note : null;

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("filter_allowlist")
      .upsert(
        { user_id: user.id, keyword_text: text, original_filter: filter, note },
        { onConflict: "user_id,keyword_text" }
      )
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true, entry: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
