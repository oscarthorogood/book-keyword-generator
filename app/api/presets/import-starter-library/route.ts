import { VINCI_SEED_GENRES, VINCI_SEED_KEYWORDS } from "@/lib/presetSeedData/vinciKeywordBank";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * POST /api/presets/import-starter-library
 *
 * Seeds the current user's preset keyword library (§3) from the checked-in
 * starter set (lib/presetSeedData/vinciKeywordBank.ts) — 9 genres, 60
 * sub-genres, 800 keywords. Idempotent: re-running it only adds whatever's
 * missing, via the same unique constraints the manual "add keyword" flow
 * relies on (preset_genres unique on user+parent+name, preset_keywords
 * unique on genre+keyword+match type) — never duplicates or overwrites a
 * genre/keyword the user already has.
 */
export async function POST() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    // Top-level genres first (their id is the FK sub-genres need).
    const topLevel = VINCI_SEED_GENRES.filter((g) => g.parentName === null);
    const { error: topError } = await supabase
      .from("preset_genres")
      .upsert(
        topLevel.map((g) => ({ user_id: user.id, name: g.name, parent_id: null })),
        { onConflict: "user_id,parent_id,name", ignoreDuplicates: true }
      );
    if (topError) {
      if (/relation .*preset_genres.* does not exist/i.test(topError.message)) {
        return Response.json({ error: "Run sql/10-preset-keywords.sql first." }, { status: 400 });
      }
      return Response.json({ error: topError.message }, { status: 400 });
    }

    const { data: topRows, error: topFetchError } = await supabase
      .from("preset_genres")
      .select("id, name")
      .eq("user_id", user.id)
      .is("parent_id", null);
    if (topFetchError) return Response.json({ error: topFetchError.message }, { status: 400 });
    const topIdByName = new Map((topRows ?? []).map((g) => [g.name, g.id]));

    const subLevel = VINCI_SEED_GENRES.filter((g) => g.parentName !== null);
    const { error: subError } = await supabase.from("preset_genres").upsert(
      subLevel
        .filter((g) => topIdByName.has(g.parentName!))
        .map((g) => ({ user_id: user.id, name: g.name, parent_id: topIdByName.get(g.parentName!) })),
      { onConflict: "user_id,parent_id,name", ignoreDuplicates: true }
    );
    if (subError) return Response.json({ error: subError.message }, { status: 400 });

    const { data: allGenreRows, error: allFetchError } = await supabase
      .from("preset_genres")
      .select("id, name")
      .eq("user_id", user.id);
    if (allFetchError) return Response.json({ error: allFetchError.message }, { status: 400 });
    // Genre names are unique per (user, parent) but not globally — the seed
    // set never reuses a name across genre and sub-genre, so a flat map is
    // safe here even though the schema allows it in principle.
    const genreIdByName = new Map((allGenreRows ?? []).map((g) => [g.name, g.id]));

    const keywordRows = VINCI_SEED_KEYWORDS.filter((k) => genreIdByName.has(k.genreName)).map((k) => ({
      user_id: user.id,
      genre_id: genreIdByName.get(k.genreName),
      keyword: k.keyword,
      match_type: "phrase",
      tier: "a",
      author_references: k.authorReferences.length > 0 ? k.authorReferences : null,
    }));

    const { data: inserted, error: keywordError } = await supabase
      .from("preset_keywords")
      .upsert(keywordRows, { onConflict: "genre_id,keyword,match_type", ignoreDuplicates: true })
      .select("id");

    if (keywordError) {
      // sql/11 (author_references) not applied yet — retry without it.
      if (/author_references/i.test(keywordError.message)) {
        const rowsWithoutRefs = keywordRows.map(({ author_references, ...row }) => {
          void author_references;
          return row;
        });
        const retry = await supabase
          .from("preset_keywords")
          .upsert(rowsWithoutRefs, { onConflict: "genre_id,keyword,match_type", ignoreDuplicates: true })
          .select("id");
        if (retry.error) return Response.json({ error: retry.error.message }, { status: 400 });
        return Response.json({
          success: true,
          genresCreated: (topRows?.length ?? 0) + subLevel.length,
          keywordsAdded: retry.data?.length ?? 0,
          needsMigration: true,
        });
      }
      return Response.json({ error: keywordError.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      genresTotal: VINCI_SEED_GENRES.length,
      keywordsAdded: inserted?.length ?? 0,
      keywordsTotal: VINCI_SEED_KEYWORDS.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
