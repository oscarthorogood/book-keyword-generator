import { addCompetitorAsin, deleteCompetitorAsin, getCompetitorAsins } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

const VALID_SOURCES = ["manual", "kdpradar", "datadive", "helium10", "sellersprite"];

/**
 * GET /api/books/[id]/competitors
 * List competitor ASINs attached to this book (spec §2.1).
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const competitors = await getCompetitorAsins(supabase, bookId, user.id);

    return Response.json({ success: true, competitors });
  } catch (err) {
    console.error("Error listing competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/books/[id]/competitors
 * Body: { competitor_asin | competitorAsin, source?, notes? }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    // Confirm the book belongs to this user before inserting, matching the
    // existing keywords route's pattern (app/api/books/[id]/keywords/route.ts).
    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id")
      .eq("id", bookId)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const competitorAsin = (body.competitor_asin ?? body.competitorAsin ?? "").toString().trim();
    if (!competitorAsin) {
      return Response.json({ error: "competitor_asin is required" }, { status: 400 });
    }

    const source = VALID_SOURCES.includes(body.source) ? body.source : "manual";
    const notes = typeof body.notes === "string" ? body.notes : null;

    const { data, error } = await addCompetitorAsin(supabase, bookId, user.id, {
      competitorAsin,
      source,
      notes,
    });

    if (error) return Response.json({ error }, { status: 400 });

    return Response.json({ success: true, competitor: data });
  } catch (err) {
    console.error("Error adding competitor ASIN:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/books/[id]/competitors
 * Body: { id: string } — removes one competitor ASIN row.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const id = typeof body.id === "string" ? body.id : undefined;
    if (!id) return Response.json({ error: "id is required" }, { status: 400 });

    const supabase = await supabaseServer();
    const { deleted, error } = await deleteCompetitorAsin(supabase, bookId, user.id, id);

    if (error) return Response.json({ error }, { status: 400 });
    if (!deleted) return Response.json({ error: "Competitor ASIN not found" }, { status: 404 });

    return Response.json({ success: true });
  } catch (err) {
    console.error("Error deleting competitor ASIN:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
