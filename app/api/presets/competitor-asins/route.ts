import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/** POST /api/presets/competitor-asins — add a competitor ASIN to a preset genre. Body: { genreId, competitorAsin, notes?, tier? } */
export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const genreId = typeof body.genreId === "string" ? body.genreId : "";
    const competitorAsin =
      typeof body.competitorAsin === "string" ? body.competitorAsin.trim().toUpperCase() : "";
    const notes = typeof body.notes === "string" ? body.notes : null;
    const tier: "a" | "b" = body.tier === "b" ? "b" : "a";

    if (!genreId || !competitorAsin) {
      return Response.json({ error: "genreId and competitorAsin are required" }, { status: 400 });
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("preset_competitor_asins")
      .insert({ user_id: user.id, genre_id: genreId, competitor_asin: competitorAsin, notes, tier })
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ success: true, competitorAsin: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
