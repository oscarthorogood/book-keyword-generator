import { loadBookWithSnapshot } from "@/lib/bookStore";
import { computeCompetitorBid } from "@/lib/competitorBidding";
import { getCompetitorAsins } from "@/lib/competitorStore";
import {
  matchGenresToBook,
  presetCompetitorAsinsForGenres,
  type PresetCompetitorAsinRow,
  type PresetGenreRow,
} from "@/lib/presetCompetitorAsins";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * POST /api/books/[id]/competitors/apply-presets
 *
 * Matches the book's resolved genre against the user's preset genre library
 * and applies the matching preset competitor ASINs (competitor-ASIN
 * enhancements task 4) — mirrors
 * app/api/books/[id]/keywords/apply-presets/route.ts, for ASINs instead of
 * keyword text. Tier B presets are inserted paused for manual review.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });
    const { snapshot, book } = loaded;

    const [{ data: genreRows, error: genreError }, { data: presetRows, error: presetError }] = await Promise.all([
      supabase.from("preset_genres").select("id, name, parent_id").eq("user_id", user.id),
      supabase
        .from("preset_competitor_asins")
        .select("id, genre_id, competitor_asin, notes, tier")
        .eq("user_id", user.id),
    ]);
    if (genreError) return Response.json({ error: genreError.message }, { status: 400 });
    if (presetError) return Response.json({ error: presetError.message }, { status: 400 });

    const genres: PresetGenreRow[] = (genreRows ?? []).map((g) => ({ id: g.id, name: g.name, parentId: g.parent_id }));
    const presetCompetitorAsins: PresetCompetitorAsinRow[] = (presetRows ?? []).map((pc) => ({
      id: pc.id,
      genreId: pc.genre_id,
      competitorAsin: pc.competitor_asin,
      notes: pc.notes,
      tier: pc.tier as "a" | "b",
    }));

    const matchedGenres = matchGenresToBook(genres, snapshot.genreTerms);
    if (matchedGenres.length === 0) {
      return Response.json({
        success: true,
        matchedGenres: [],
        appliedCount: 0,
        message: "No preset genres matched this book's resolved genre — nothing to apply.",
      });
    }
    const matchedGenreIds = new Set(matchedGenres.map((g) => g.id));

    const { candidates } = presetCompetitorAsinsForGenres(presetCompetitorAsins, matchedGenreIds);
    if (candidates.length === 0) {
      return Response.json({
        success: true,
        matchedGenres: matchedGenres.map((g) => g.name),
        appliedCount: 0,
        message: "Matched genres have no preset competitor ASINs yet.",
      });
    }

    // Dedupe against ASINs already tracked for this book, and against the
    // book's own ASIN — a preset competitor ASIN can't be the seed book
    // itself.
    const { data: existing } = await getCompetitorAsins(supabase, bookId, user.id);
    const existingAsins = new Set(existing.map((row) => row.competitor_asin.toUpperCase()));
    const ownAsin = (snapshot.asin ?? book.asin ?? "").toUpperCase();

    const newCandidates = candidates.filter(
      (c) => c.competitorAsin !== ownAsin && !existingAsins.has(c.competitorAsin)
    );

    if (newCandidates.length === 0) {
      return Response.json({
        success: true,
        matchedGenres: matchedGenres.map((g) => g.name),
        appliedCount: 0,
        message: "Every matching preset competitor ASIN is already tracked for this book.",
      });
    }

    // Generation of any kind — including applying a preset list — always
    // lands in "archived"; "Run Filters" (or a manual promotion) is what
    // moves a row into active/paused/rejected.
    const rows = newCandidates.map((candidate) => {
      return {
        book_id: bookId,
        user_id: user.id,
        competitor_asin: candidate.competitorAsin,
        source: "genre-preset" as const,
        notes: candidate.notes,
        status: "archived" as const,
        bid: computeCompetitorBid({}),
        preset_competitor_asin_id: candidate.presetCompetitorAsinId,
      };
    });

    const { data: inserted, error: insertError } = await supabase
      .from("competitor_asins")
      .upsert(rows, { onConflict: "book_id,competitor_asin", ignoreDuplicates: true })
      .select("id");

    if (insertError) return Response.json({ error: insertError.message }, { status: 400 });

    // Subscribe the book to every matched genre, so future edits to that
    // genre's preset competitor-ASIN list know to propagate here (idempotent
    // — a re-apply just re-affirms the subscription).
    await supabase
      .from("book_preset_competitor_asin_genres")
      .upsert(
        matchedGenres.map((g) => ({ book_id: bookId, genre_id: g.id, user_id: user.id })),
        { onConflict: "book_id,genre_id", ignoreDuplicates: true }
      );

    return Response.json({
      success: true,
      matchedGenres: matchedGenres.map((g) => g.name),
      appliedCount: inserted?.length ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
