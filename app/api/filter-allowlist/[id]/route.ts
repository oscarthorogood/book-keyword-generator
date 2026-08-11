import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/** DELETE /api/filter-allowlist/[id] — future generate runs can reject this text again. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { error } = await supabase.from("filter_allowlist").delete().eq("id", id).eq("user_id", user.id);

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
