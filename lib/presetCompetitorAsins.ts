/**
 * Preset competitor-ASIN library (competitor-ASIN enhancements task 4):
 * matching a book's resolved genre against the same preset genre tree the
 * keyword library uses (lib/presetKeywords.ts's matchGenresToBook, reused
 * rather than duplicated — see sql/18-preset-competitor-asins.sql's comment
 * on reusing preset_genres), and turning the matched preset competitor
 * ASINs into ordinary competitor_asins candidates.
 */

export { matchGenresToBook, type PresetGenreRow } from "./presetKeywords";

export interface PresetCompetitorAsinRow {
  id: string;
  genreId: string;
  competitorAsin: string;
  notes: string | null;
  /** Tier A applies automatically; Tier B is inserted paused for manual review. */
  tier: "a" | "b";
}

export interface PresetCompetitorAsinCandidate {
  competitorAsin: string;
  notes: string | null;
  presetCompetitorAsinId: string;
}

/**
 * Preset competitor ASINs under any of the matched genres, as candidates
 * ready to insert into `competitor_asins` (source "genre-preset"). Tier B
 * candidates are flagged via the returned `tierById` map so the caller can
 * force them to `paused` regardless of the usual re-run-filters verdict.
 */
export function presetCompetitorAsinsForGenres(
  presetCompetitorAsins: PresetCompetitorAsinRow[],
  matchedGenreIds: Set<string>
): { candidates: PresetCompetitorAsinCandidate[]; tierById: Map<string, "a" | "b"> } {
  const relevant = presetCompetitorAsins.filter((pc) => matchedGenreIds.has(pc.genreId));
  const tierById = new Map(relevant.map((pc) => [pc.id, pc.tier]));
  const candidates = relevant.map((pc) => ({
    competitorAsin: pc.competitorAsin.toUpperCase(),
    notes: pc.notes,
    presetCompetitorAsinId: pc.id,
  }));
  return { candidates, tierById };
}
