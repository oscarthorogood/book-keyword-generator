import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * PATCH /api/keywords/[id]
 * Update a keyword's status, match type, category, or bid
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {};

    if (typeof body.status === "string") updates.status = body.status;
    if (typeof body.matchType === "string") updates.match_type = body.matchType;
    if (typeof body.category === "string" || body.category === null) updates.category = body.category;
    if (typeof body.bid === "number" || body.bid === null) updates.bid = body.bid;
    if (typeof body.text === "string") updates.text = body.text.trim();

    // A manual edit to the text or match type takes this row out of sync
    // with its preset (§3) — clear the link so a later library edit never
    // clobbers what the user just typed.
    if (typeof body.text === "string" || typeof body.matchType === "string") {
      updates.preset_keyword_id = null;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = await supabaseServer();

    let { data: keyword, error } = await supabase
      .from("keywords")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    // sql/10-preset-keywords.sql adds preset_keyword_id. On a database that
    // hasn't had it applied yet, drop it and retry rather than failing every
    // keyword edit.
    if (error && /preset_keyword_id/i.test(error.message) && "preset_keyword_id" in updates) {
      const { preset_keyword_id, ...updatesWithoutPreset } = updates;
      void preset_keyword_id;
      ({ data: keyword, error } = await supabase
        .from("keywords")
        .update(updatesWithoutPreset)
        .eq("id", id)
        .eq("user_id", user.id)
        .select()
        .single());
    }

    if (error || !keyword) {
      return Response.json(
        { error: error?.message || "Keyword not found" },
        { status: error ? 400 : 404 }
      );
    }

    return Response.json({ success: true, keyword });
  } catch (err) {
    console.error("Error updating keyword:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/keywords/[id]
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    const { error } = await supabase
      .from("keywords")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ success: true });
  } catch (err) {
    console.error("Error deleting keyword:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
