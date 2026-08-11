/**
 * Preset keyword library (Enhancements spec §3): matching a book's resolved
 * genre against the user's preset genre tree, and turning the matched
 * preset keywords into ordinary keyword candidates that flow through the
 * same merge/dedup/filter pipeline generation uses — presets are trusted,
 * not exempt.
 */

import type { KeywordCandidate, MatchType } from "./types";

export interface PresetGenreRow {
  id: string;
  name: string;
  parentId: string | null;
}

export interface PresetKeywordRow {
  id: string;
  genreId: string;
  keyword: string;
  matchType: MatchType;
  /** Tier A applies automatically; Tier B is inserted paused for manual review. */
  tier: "a" | "b";
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Which of the user's preset genres apply to this book, matched against the
 * book's own resolved genre vocabulary (lib/genre.ts's genreTerms) — exact
 * match or substring (a genre "cozy mystery" matches a resolved term like
 * "cozy mystery" or "cozy amateur sleuth mystery").
 */
export function matchGenresToBook(genres: PresetGenreRow[], bookGenreTerms: string[]): PresetGenreRow[] {
  const normalizedTerms = bookGenreTerms.map(normalize);
  return genres.filter((genre) => {
    const name = normalize(genre.name);
    if (!name) return false;
    return normalizedTerms.some((term) => term === name || term.includes(name) || name.includes(term));
  });
}

/**
 * Preset keywords under any of the matched genres, as ordinary keyword
 * candidates (source "genre-preset") ready for the merge/filter pipeline.
 * Tier B candidates carry `matchTypeCeiling` unset but are flagged via the
 * returned `tier` map so the caller can force them to `paused` regardless
 * of the filter verdict.
 */
export function presetKeywordsForGenres(
  presetKeywords: PresetKeywordRow[],
  matchedGenreIds: Set<string>
): { candidates: Array<KeywordCandidate & { presetKeywordId: string; presetMatchType: MatchType }>; tierById: Map<string, "a" | "b"> } {
  const relevant = presetKeywords.filter((pk) => matchedGenreIds.has(pk.genreId));
  const tierById = new Map(relevant.map((pk) => [pk.id, pk.tier]));
  const candidates = relevant.map((pk) => ({
    text: pk.keyword,
    sources: ["genre-preset"] as KeywordCandidate["sources"],
    presetKeywordId: pk.id,
    presetMatchType: pk.matchType,
  }));
  return { candidates, tierById };
}
