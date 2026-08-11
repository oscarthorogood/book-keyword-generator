import { deleteCompetitorKeywords, getCompetitorKeywords } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

const MATCH_TYPES = ["broad", "phrase", "exact"];
const STATUSES = ["active", "paused", "negative", "archived", "rejected"];

/**
 * GET /api/books/[id]/competitor-keywords
 * List competitor keywords for the book (spec §2.2), optionally filtered by
 * ?category=&matchType=&minVolume=&maxRank=&minCompetitorCount=
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const url = new URL(request.url);
    const category = url.searchParams.get("category") ?? undefined;
    const matchType = url.searchParams.get("matchType") ?? undefined;
    const minVolume = url.searchParams.has("minVolume") ? Number(url.searchParams.get("minVolume")) : undefined;
    const maxRank = url.searchParams.has("maxRank") ? Number(url.searchParams.get("maxRank")) : undefined;
    const minCompetitorCount = url.searchParams.has("minCompetitorCount")
      ? Number(url.searchParams.get("minCompetitorCount"))
      : undefined;

    const supabase = await supabaseServer();
    const keywords = await getCompetitorKeywords(supabase, bookId, user.id, {
      category,
      matchType,
      minVolume,
      maxRank,
      minCompetitorCount,
    });

    return Response.json({ success: true, keywords });
  } catch (err) {
    console.error("Error listing competitor keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/books/[id]/competitor-keywords
 * Bulk status/match-type change — mirrors PATCH /api/books/[id]/keywords.
 * Body: { ids: string[], status?: CompetitorKeywordStatus, matchType?: MatchType }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (ids.length === 0) return Response.json({ error: "No keywords selected" }, { status: 400 });

    const updates: Record<string, unknown> = {};
    if (typeof body.status === "string" && STATUSES.includes(body.status)) updates.status = body.status;
    if (typeof body.matchType === "string" && MATCH_TYPES.includes(body.matchType)) {
      updates.match_type = body.matchType;
    }

    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("competitor_keywords")
      .update(updates)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("id", ids)
      .select("id");

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({ success: true, updatedCount: data?.length ?? 0 });
  } catch (err) {
    console.error("Error bulk-updating competitor keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/books/[id]/competitor-keywords
 * Body: { ids: string[] }
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (ids.length === 0) return Response.json({ error: "No keywords selected" }, { status: 400 });

    const supabase = await supabaseServer();
    const { deletedCount, error } = await deleteCompetitorKeywords(supabase, bookId, user.id, ids);

    if (error) return Response.json({ error }, { status: 400 });

    return Response.json({ success: true, deletedCount });
  } catch (err) {
    console.error("Error deleting competitor keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
