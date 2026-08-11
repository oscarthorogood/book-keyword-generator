import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * PATCH /api/presets/competitor-asins/[id] — edit a preset competitor
 * ASIN's ASIN/notes/tier. Propagates the ASIN/notes change to every book
 * that still carries this preset's `preset_competitor_asin_id`
 * (sql/18-preset-competitor-asins.sql) — a book where the user manually
 * edited that row's notes already had the link cleared (see
 * app/api/competitors/[id]/route.ts), so propagation can never clobber it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.competitorAsin === "string" && body.competitorAsin.trim()) {
      updates.competitor_asin = body.competitorAsin.trim().toUpperCase();
    }
    if (typeof body.notes === "string" || body.notes === null) updates.notes = body.notes;
    if (body.tier === "a" || body.tier === "b") updates.tier = body.tier;

    if (Object.keys(updates).length === 0) return Response.json({ error: "No valid fields to update" }, { status: 400 });

    const supabase = await supabaseServer();
    const { data: presetCompetitorAsin, error } = await supabase
      .from("preset_competitor_asins")
      .update(updates)
      .eq("id", id)
      .eq("user_id", user.id)
      .select()
      .single();

    if (error || !presetCompetitorAsin) {
      return Response.json({ error: error?.message || "Preset competitor ASIN not found" }, { status: error ? 400 : 404 });
    }

    let propagatedCount = 0;
    if (updates.competitor_asin || "notes" in updates) {
      const propagateUpdates: Record<string, unknown> = {};
      if (updates.competitor_asin) propagateUpdates.competitor_asin = updates.competitor_asin;
      if ("notes" in updates) propagateUpdates.notes = updates.notes;

      const { data: propagated, error: propagateError } = await supabase
        .from("competitor_asins")
        .update(propagateUpdates)
        .eq("preset_competitor_asin_id", id)
        .eq("user_id", user.id)
        .select("id, book_id");

      if (propagateError) return Response.json({ error: propagateError.message }, { status: 400 });
      propagatedCount = propagated?.length ?? 0;
    }

    return Response.json({ success: true, presetCompetitorAsin, propagatedCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/presets/competitor-asins/[id] — removes the preset. Rows
 * already applied to books are left in place as ordinary manually-tracked
 * competitor ASINs (preset_competitor_asin_id SET NULL via the FK) rather
 * than deleted from the book.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { error } = await supabase.from("preset_competitor_asins").delete().eq("id", id).eq("user_id", user.id);

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
