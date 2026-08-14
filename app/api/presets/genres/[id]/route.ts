import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/** PATCH /api/presets/genres/[id] — rename a genre. Body: { name } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return Response.json({ error: "Genre name is required" }, { status: 400 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("preset_genres")
      .update({ name })
      .eq("id", id)
      .select()
      .single();

    if (error || !data)
      return Response.json(
        { error: error?.message || "Genre not found" },
        { status: error ? 400 : 404 }
      );
    return Response.json({ success: true, genre: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/presets/genres/[id] — deletes the genre and its preset
 * keywords (cascade). Keywords already applied to books stay on those
 * books as ordinary manual keywords (preset_keyword_id is SET NULL, not
 * cascaded) — deleting a preset never deletes a book's live keyword.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { error } = await supabase.from("preset_genres").delete().eq("id", id);

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
