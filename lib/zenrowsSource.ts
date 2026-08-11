/**
 * ZenRows — a general-purpose scraping API (JS rendering + rotating
 * residential/premium proxies), used here the same way Decodo is
 * (lib/decodoSource.ts): live-fetched search/related-term rows get scored
 * and turned into keyword candidates through the same relevance threshold
 * and branded/mood classification, then run through the full filter chain
 * and cap-and-rank like every other source (wired in
 * app/api/books/[id]/keywords/generate/route.ts) rather than trusted
 * outright.
 */

import { normalize } from "./keywordMerge";
import { KeywordCandidate, MatchType } from "./types";

/** One row surfaced by a ZenRows scrape: a term plus a synthesized relevance score. */
export interface ZenrowsRow {
  text: string;
  /** 0-1 relevance score, synthesized from result rank (see lib/zenrowsClient.ts). */
  score: number;
  matchType?: MatchType;
}

/** Minimum ZenRows relevance score (0-1 scale) for a row to be worth a keyword slot. */
export const MIN_SCORE_FOR_KEEP = 0.5;

/**
 * Builds candidates from ZenRows scrape rows above the relevance threshold.
 * Branded terms (matching the book's own title/author/series) are tagged
 * brand/alpha-core; generic on-genre terms fall to genre-core/mood-setting —
 * identical classification shape to buildDecodoCandidates, so both sources
 * feed the merge/scoring pipeline consistently.
 */
export function buildZenrowsCandidates(
  book: { title?: string; author?: string; seriesName?: string },
  zenrowsData: ZenrowsRow[],
  options: { minScore?: number } = {}
): KeywordCandidate[] {
  const minScore = options.minScore ?? MIN_SCORE_FOR_KEEP;
  const kept = zenrowsData.filter((row) => row.score >= minScore);

  const titleNorm = book.title ? normalize(book.title) : undefined;
  const authorNorm = book.author ? normalize(book.author) : undefined;
  const seriesNorm = book.seriesName ? normalize(book.seriesName) : undefined;

  const moodWords = ["dark", "cozy", "gritty", "atmospheric", "chilling", "gripping", "twisty"];

  return kept.map((row) => {
    const isBranded =
      (titleNorm && row.text.includes(titleNorm)) ||
      (authorNorm && row.text.includes(authorNorm)) ||
      (seriesNorm && row.text.includes(seriesNorm));
    const isMood = moodWords.some((word) => row.text.includes(word));

    const category = isBranded ? "core-genre" : isMood ? "mood-tone" : "sub-genre";
    const intentSegment = isBranded ? "alpha-core" : isMood ? "mood-setting" : "genre-core";
    const wordCount = row.text.split(/\s+/).filter(Boolean).length;
    const lengthPoints = wordCount >= 4 ? 2 : wordCount === 3 ? 1 : 0;
    const scorePoints = row.score >= 0.85 ? 2 : row.score >= 0.65 ? 1 : 0;
    const specificity = Math.max(1, Math.min(5, 2 + lengthPoints + scorePoints));

    const candidate: KeywordCandidate = {
      text: row.text,
      sources: ["zenrows"],
      category,
      intentSegment,
      matchType: row.matchType,
      specificity,
    };
    return candidate;
  });
}
