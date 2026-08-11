import { deleteCompetitorAsinById, updateCompetitorAsin } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { CompetitorAsin } from "@/lib/types";

const STATUSES: CompetitorAsin["status"][] = ["active", "paused", "negative", "archived", "rejected"];

/**
 * PATCH /api/competitors/[id]
 * Update a competitor ASIN's status, bid, or notes — mirrors PATCH
 * /api/keywords/[id] so a single row edit in the manager table behaves the
 * same way for competitor ASINs as it does for keywords.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const updates: { status?: CompetitorAsin["status"]; bid?: number | null; notes?: string | null } = {};

    if (typeof body.status === "string" && STATUSES.includes(body.status)) updates.status = body.status;
    if (typeof body.bid === "number" || body.bid === null) updates.bid = body.bid;
    if (typeof body.notes === "string" || body.notes === null) updates.notes = body.notes;

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data, error } = await updateCompetitorAsin(supabase, user.id, id, updates);

    if (error || !data) {
      return Response.json({ error: error || "Competitor ASIN not found" }, { status: error ? 400 : 404 });
    }

    return Response.json({ success: true, competitor: data });
  } catch (err) {
    console.error("Error updating competitor ASIN:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/competitors/[id]
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { error } = await deleteCompetitorAsinById(supabase, user.id, id);

    if (error) return Response.json({ error }, { status: 400 });

    return Response.json({ success: true });
  } catch (err) {
    console.error("Error deleting competitor ASIN:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
