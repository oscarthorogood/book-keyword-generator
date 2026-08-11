import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * PATCH /api/competitor-keywords/[id]
 * Update a competitor keyword's status, match type, bid, or text — mirrors
 * PATCH /api/keywords/[id] so a single row edit in the manager table behaves
 * identically for competitor keywords as it does for ordinary keywords.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.status === "string") updates.status = body.status;
    if (typeof body.matchType === "string") updates.match_type = body.matchType;
    if (typeof body.bid === "number" || body.bid === null) updates.bid = body.bid;
    if (typeof body.text === "string") updates.text = body.text.trim();

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = await supabaseServer();

    const { data: keyword, error } = await supabase
      .from("competitor_keywords")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !keyword) {
      return Response.json({ error: error?.message || "Competitor keyword not found" }, { status: error ? 400 : 404 });
    }

    return Response.json({ success: true, keyword });
  } catch (err) {
    console.error("Error updating competitor keyword:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/competitor-keywords/[id]
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { error } = await supabase.from("competitor_keywords").delete().eq("id", id).eq("user_id", user.id);

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ success: true });
  } catch (err) {
    console.error("Error deleting competitor keyword:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
