import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

const MATCH_TYPES: MatchType[] = ["broad", "phrase", "exact"];

/** POST /api/presets/keywords — add a keyword to a preset genre. Body: { genreId, keyword, matchType?, tier? } */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const genreId = typeof body.genreId === "string" ? body.genreId : "";
    const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
    const matchType: MatchType = MATCH_TYPES.includes(body.matchType) ? body.matchType : "phrase";
    const tier: "a" | "b" = body.tier === "b" ? "b" : "a";

    if (!genreId || !keyword) return Response.json({ error: "genreId and keyword are required" }, { status: 400 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("preset_keywords")
      .insert({ user_id: user.id, genre_id: genreId, keyword, match_type: matchType, tier })
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true, keyword: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
