import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * GET /api/books/[id]
 * Get a specific book
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    // Get authenticated user
    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    let { data: book, error: bookError } = await supabase
      .from("books")
      .select(
        `
        id,
        asin,
        title,
        author,
        marketplace,
        description,
        total_keywords,
        created_at,
        metadata_json,
        match_type_profile
      `
      )
      .eq("id", id)
      .single();

    // sql/13-match-type-profile.sql not applied yet — retry without the
    // column rather than 404ing every book page on it.
    if (bookError && /match_type_profile/i.test(bookError.message)) {
      ({ data: book, error: bookError } = await supabase
        .from("books")
        .select(
          `
          id,
          asin,
          title,
          author,
          marketplace,
          description,
          total_keywords,
          created_at,
          metadata_json
        `
        )
        .eq("id", id)
        .single());
      if (book) book = { ...book, match_type_profile: "mixed" };
    }

    if (bookError || !book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    return Response.json({
      success: true,
      book,
    });
  } catch (err) {
    console.error("Error in get book:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/books/[id]
 * Currently just the §21 match-type profile — a per-book "mixed" vs
 * "phrase-only" keyword-generation strategy toggle.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const updates: Record<string, unknown> = {};
    if (body.matchTypeProfile === "mixed" || body.matchTypeProfile === "phrase-only") {
      updates.match_type_profile = body.matchTypeProfile;
    }
    if (Object.keys(updates).length === 0) {
      return Response.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data: book, error } = await supabase
      .from("books")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error || !book) {
      return Response.json(
        { error: error?.message || "Book not found" },
        { status: error ? 400 : 404 }
      );
    }

    return Response.json({ success: true, book });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
