import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

const MATCH_TYPES: MatchType[] = ["broad", "phrase", "exact"];

/**
 * PATCH /api/presets/keywords/[id] — edit a preset keyword's text/match
 * type/tier. Propagates the text/match-type change to every book that
 * still carries this preset's `preset_keyword_id` (§3) — a book where the
 * user manually edited that keyword already had the link cleared (see
 * `app/api/keywords/[id]/route.ts`), so propagation can never clobber it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (typeof body.keyword === "string" && body.keyword.trim())
      updates.keyword = body.keyword.trim();
    if (typeof body.matchType === "string" && MATCH_TYPES.includes(body.matchType))
      updates.match_type = body.matchType;
    if (body.tier === "a" || body.tier === "b") updates.tier = body.tier;

    if (Object.keys(updates).length === 0)
      return Response.json({ error: "No valid fields to update" }, { status: 400 });

    const supabase = await supabaseServer();
    const { data: presetKeyword, error } = await supabase
      .from("preset_keywords")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error || !presetKeyword) {
      return Response.json(
        { error: error?.message || "Preset keyword not found" },
        { status: error ? 400 : 404 }
      );
    }

    let propagatedCount = 0;
    if (updates.keyword || updates.match_type) {
      const propagateUpdates: Record<string, unknown> = {};
      if (updates.keyword) propagateUpdates.text = updates.keyword;
      if (updates.match_type) propagateUpdates.match_type = updates.match_type;

      const { data: propagated, error: propagateError } = await supabase
        .from("keywords")
        .update(propagateUpdates)
        .eq("preset_keyword_id", id)
        .select("id, book_id");

      if (propagateError) return Response.json({ error: propagateError.message }, { status: 400 });
      propagatedCount = propagated?.length ?? 0;
    }

    return Response.json({ success: true, presetKeyword, propagatedCount });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/presets/keywords/[id] — removes the preset. Keywords already
 * applied to books are left in place as ordinary manual keywords
 * (preset_keyword_id SET NULL via the FK) rather than deleted from the
 * book — removing a preset from the library shouldn't silently pull a
 * keyword out from under an active campaign.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { error } = await supabase.from("preset_keywords").delete().eq("id", id);

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
