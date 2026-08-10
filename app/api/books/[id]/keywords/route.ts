import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

const MATCH_TYPES = ["broad", "phrase", "exact"];
const STATUSES = ["active", "paused", "negative", "archived"];

/** One entry of a manual add — accepts either camelCase or the column names. */
interface KeywordInput {
  text?: unknown;
  matchType?: string;
  match_type?: string;
  category?: string | null;
  source?: string;
  bid?: number | null;
}

/**
 * GET /api/books/[id]/keywords
 * List all keywords for a book
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    const { data: keywords, error } = await supabase
      .from("keywords")
      .select("*")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ success: true, keywords });
  } catch (err) {
    console.error("Error listing keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/books/[id]/keywords
 * Add one or more keywords to a book
 * Body: { text: string, matchType?: string, category?: string, bid?: number }
 *    or { keywords: Array<{ text, matchType?, category?, bid? }> }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    // Confirm the book belongs to this user before inserting
    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id")
      .eq("id", bookId)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    const body = await request.json();
    const rawEntries: KeywordInput[] = Array.isArray(body.keywords) ? body.keywords : [body];

    const rows = rawEntries
      .filter((entry): entry is KeywordInput & { text: string } =>
        !!entry && typeof entry.text === "string" && entry.text.trim().length > 0
      )
      .map((entry) => ({
        book_id: bookId,
        user_id: user.id,
        text: entry.text.trim(),
        match_type: entry.matchType || entry.match_type || "phrase",
        category: entry.category || null,
        source: entry.source || "manual",
        bid: entry.bid ?? null,
      }));

    if (rows.length === 0) {
      return Response.json(
        { error: "No valid keywords provided" },
        { status: 400 }
      );
    }

    const { data: inserted, error: insertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "book_id,text,match_type", ignoreDuplicates: false })
      .select();

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    return Response.json({ success: true, keywords: inserted });
  } catch (err) {
    console.error("Error adding keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/books/[id]/keywords
 * Bulk status/match-type change.
 * Body: { ids: string[], status?: KeywordStatus, matchType?: MatchType }
 *
 * A generate run produces hundreds of keywords, so reviewing them means
 * changing them in batches — one request per row would mean hundreds of
 * round trips for a single "pause these" click.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (ids.length === 0) {
      return Response.json({ error: "No keywords selected" }, { status: 400 });
    }

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
      .from("keywords")
      .update(updates)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("id", ids)
      .select("id");

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ success: true, updatedCount: data?.length ?? 0 });
  } catch (err) {
    console.error("Error bulk-updating keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * DELETE /api/books/[id]/keywords
 * Body: { ids: string[] } to delete a selection, or { all: true } to clear
 * the book's whole keyword list (used to re-generate from scratch).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const ids: string[] = Array.isArray(body.ids)
      ? body.ids.filter((id: unknown): id is string => typeof id === "string")
      : [];

    if (ids.length === 0 && body.all !== true) {
      return Response.json({ error: "No keywords selected" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    let query = supabase.from("keywords").delete().eq("book_id", bookId).eq("user_id", user.id);
    if (body.all !== true) query = query.in("id", ids);

    const { data, error } = await query.select("id");

    if (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ success: true, deletedCount: data?.length ?? 0 });
  } catch (err) {
    console.error("Error bulk-deleting keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
