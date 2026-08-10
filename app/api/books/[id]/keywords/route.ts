import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

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
    const rawEntries = Array.isArray(body.keywords)
      ? body.keywords
      : [body];

    const rows = rawEntries
      .filter((entry: any) => entry && typeof entry.text === "string" && entry.text.trim())
      .map((entry: any) => ({
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
