import { loadBookWithSnapshot } from "@/lib/bookStore";
import { buildFilterContext, applyFiltersToCandidates } from "@/lib/keywordFilters";
import { dedupeSignature, scoreAndTierBids } from "@/lib/keywordMerge";
import {
  matchGenresToBook,
  presetKeywordsForGenres,
  type PresetGenreRow,
  type PresetKeywordRow,
} from "@/lib/presetKeywords";
import { scoreSpecificity } from "@/lib/keywordSpecificity";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { KeywordSource, MatchType } from "@/lib/types";

export const runtime = "nodejs";

/**
 * POST /api/books/[id]/keywords/apply-presets
 *
 * Matches the book's resolved genre against the user's preset genre
 * library and applies the matching preset keywords (Enhancements spec §3).
 * Presets are trusted but not exempt: every candidate still runs through
 * the same filter pipeline generation uses, and a preset rejected for this
 * specific book stays visible with its reason rather than being silently
 * dropped. Tier B presets are inserted paused for manual review regardless
 * of the filter verdict.
 *
 * NOTE: `decision_log` (ARCHITECTURE §5.2) doesn't exist in this tree yet
 * (see AUDIT_IMPROVEMENTS.md's §0.1 correction) — this apply run isn't
 * logged there. Once that table lands, this route should write to it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const loaded = await loadBookWithSnapshot(supabase, bookId);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });
    const { snapshot } = loaded;

    const [
      { data: genreRows, error: genreError },
      { data: presetKeywordRows, error: presetError },
    ] = await Promise.all([
      supabase.from("preset_genres").select("id, name, parent_id"),
      supabase.from("preset_keywords").select("id, genre_id, keyword, match_type, tier"),
    ]);
    if (genreError) return Response.json({ error: genreError.message }, { status: 400 });
    if (presetError) return Response.json({ error: presetError.message }, { status: 400 });

    const genres: PresetGenreRow[] = (genreRows ?? []).map((g) => ({
      id: g.id,
      name: g.name,
      parentId: g.parent_id,
    }));
    const presetKeywords: PresetKeywordRow[] = (presetKeywordRows ?? []).map((pk) => ({
      id: pk.id,
      genreId: pk.genre_id,
      keyword: pk.keyword,
      matchType: pk.match_type as MatchType,
      tier: pk.tier as "a" | "b",
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

    const { candidates, tierById } = presetKeywordsForGenres(presetKeywords, matchedGenreIds);
    if (candidates.length === 0) {
      return Response.json({
        success: true,
        matchedGenres: matchedGenres.map((g) => g.name),
        appliedCount: 0,
        message: "Matched genres have no preset keywords yet.",
      });
    }

    // Dedupe against keywords already on this book (near-duplicate
    // signature, per spec) — presets that would just re-add an existing
    // keyword are skipped rather than colliding on upsert.
    const { data: existingKeywords, error: existingError } = await supabase
      .from("keywords")
      .select("text")
      .eq("book_id", bookId);
    if (existingError) return Response.json({ error: existingError.message }, { status: 400 });
    const existingSignatures = new Set(
      (existingKeywords ?? []).map((k) => dedupeSignature(k.text) || k.text.toLowerCase())
    );

    const newCandidates = candidates.filter((c) => {
      const sig = dedupeSignature(c.text) || c.text.toLowerCase();
      return !existingSignatures.has(sig);
    });

    if (newCandidates.length === 0) {
      return Response.json({
        success: true,
        matchedGenres: matchedGenres.map((g) => g.name),
        appliedCount: 0,
        message: "Every matching preset keyword is already on this book.",
      });
    }

    const filterContext = buildFilterContext({
      title: snapshot.title,
      asin: snapshot.asin,
      author: snapshot.author,
      seriesName: snapshot.seriesName,
      description: snapshot.description,
      genreTerms: snapshot.genreTerms,
      genreFamilies: snapshot.genreFamilies,
      categoryPath: snapshot.categoryPath,
      categories: snapshot.categories,
      goodreadsTags: snapshot.goodreadsTags,
      competitors: snapshot.competitors,
      compTitles: snapshot.compTitles,
      reviewSnippets: snapshot.reviewSnippets,
      marketplace: snapshot.marketplace,
      language: snapshot.language,
      formats: snapshot.formats ?? [],
      isKindleUnlimited: !!snapshot.isKindleUnlimited,
    });

    const scored = scoreAndTierBids(newCandidates, 0.5);
    const { passed, paused, rejected } = applyFiltersToCandidates(
      scored,
      filterContext
    ) as unknown as {
      passed: Array<(typeof newCandidates)[number] & { matchTypeCeiling?: MatchType }>;
      paused: Array<(typeof newCandidates)[number] & { filter?: string; reason?: string }>;
      rejected: Array<(typeof newCandidates)[number] & { filter?: string; reason?: string }>;
    };

    const userId = user.id;

    // Generation of any kind — including applying a preset list — always
    // lands in "archived". The filter verdict (and preset tier) is still
    // recorded in rejection_reason/rejected_by_filter for the bank UI;
    // "Run Filters" (or a manual promotion) is what moves a row into
    // active/paused/rejected.
    function rowFor(
      candidate: (typeof newCandidates)[number] & { filter?: string; reason?: string },
      verdict: "active" | "paused" | "rejected"
    ) {
      const tier = tierById.get(candidate.presetKeywordId) ?? "a";
      return {
        book_id: bookId,
        user_id: userId,
        text: candidate.text,
        match_type: candidate.presetMatchType,
        category: null,
        source: "genre-preset" as KeywordSource,
        bid: candidate.suggestedBid ?? 0.5,
        status: "archived" as const,
        rejection_reason:
          candidate.reason ??
          (tier === "b" && verdict === "active"
            ? "Tier B preset — review before activating."
            : null),
        rejected_by_filter: candidate.filter ?? null,
        specificity: scoreSpecificity(candidate, filterContext.anchors),
        preset_keyword_id: candidate.presetKeywordId,
      };
    }

    const rows = [
      ...passed.map((c) => rowFor(c, "active")),
      ...paused.map((c) => rowFor(c, "paused")),
      ...rejected.map((c) => rowFor(c, "rejected")),
    ];

    const { data: inserted, error: insertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
      .select();

    if (insertError) {
      // sql/09 (specificity) or sql/10 (preset_keyword_id) not applied yet.
      const needsMigration = /specificity|preset_keyword_id/i.test(insertError.message);
      if (needsMigration) {
        const strippedRows = rows.map(({ specificity, preset_keyword_id, ...row }) => {
          void specificity;
          void preset_keyword_id;
          return row;
        });
        const retry = await supabase
          .from("keywords")
          .upsert(strippedRows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
          .select();
        if (retry.error) return Response.json({ error: retry.error.message }, { status: 400 });
        return Response.json({
          success: true,
          matchedGenres: matchedGenres.map((g) => g.name),
          appliedCount: retry.data?.length ?? 0,
          needsMigration: true,
        });
      }
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    // Subscribe the book to every matched genre, so future edits to that
    // genre's preset list know to propagate here (idempotent — a re-apply
    // just re-affirms the subscription).
    await supabase.from("book_preset_genres").upsert(
      matchedGenres.map((g) => ({ book_id: bookId, genre_id: g.id, user_id: user.id })),
      { onConflict: "book_id,genre_id", ignoreDuplicates: true }
    );

    return Response.json({
      success: true,
      matchedGenres: matchedGenres.map((g) => g.name),
      appliedCount: inserted?.length ?? 0,
      activeCount: passed.length,
      pausedCount: paused.length + rejected.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
