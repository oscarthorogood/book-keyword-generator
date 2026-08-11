import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/presets/genres — the user's preset genre tree, with each
 * genre's preset keywords nested (Enhancements spec §3).
 *
 * POST /api/presets/genres — create a genre or sub-genre.
 * Body: { name, parentId? }
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [{ data: genres, error: genreError }, { data: keywords, error: keywordError }] = await Promise.all([
      supabase.from("preset_genres").select("id, name, parent_id, created_at").eq("user_id", user.id).order("name"),
      supabase
        .from("preset_keywords")
        .select("id, genre_id, keyword, match_type, specificity, tier")
        .eq("user_id", user.id)
        .order("keyword"),
    ]);

    if (genreError) {
      if (/relation .*preset_genres.* does not exist/i.test(genreError.message)) {
        return Response.json({ success: true, genres: [], needsMigration: true });
      }
      return Response.json({ error: genreError.message }, { status: 400 });
    }
    if (keywordError) return Response.json({ error: keywordError.message }, { status: 400 });

    const keywordsByGenre = new Map<string, typeof keywords>();
    for (const kw of keywords ?? []) {
      if (!keywordsByGenre.has(kw.genre_id)) keywordsByGenre.set(kw.genre_id, []);
      keywordsByGenre.get(kw.genre_id)!.push(kw);
    }

    return Response.json({
      success: true,
      genres: (genres ?? []).map((g) => ({ ...g, keywords: keywordsByGenre.get(g.id) ?? [] })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return Response.json({ error: "Genre name is required" }, { status: 400 });
    const parentId = typeof body.parentId === "string" ? body.parentId : null;

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("preset_genres")
      .insert({ user_id: user.id, name, parent_id: parentId })
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true, genre: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
