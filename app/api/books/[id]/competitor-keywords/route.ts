import { deleteCompetitorKeywords, getCompetitorKeywords } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

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
