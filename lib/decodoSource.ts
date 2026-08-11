/**
 * Decodo (spec §7) — accepts Decodo CSV/JSON export rows (a scrape/SERP
 * data provider) and turns relevance-scored terms into candidates. These run
 * through the full filter chain and cap-and-rank like every other source
 * (wired in app/api/books/[id]/keywords/generate/route.ts) rather than being
 * trusted outright — a high Decodo score isn't a guarantee of book intent.
 */

import { normalize } from "./keywordMerge";
import { KeywordCandidate, MatchType } from "./types";

/** One normalized row from a Decodo export. */
export interface DecodoRow {
  text: string;
  /** Decodo's own relevance/quality score, 0-1 (or 0-100, auto-scaled). */
  score: number;
  matchType?: MatchType;
}

/** Minimum Decodo relevance score (0-1 scale) for a row to be worth a keyword slot. */
export const MIN_SCORE_FOR_KEEP = 0.5;

export function parseDecodoRows(rawRows: Array<Record<string, unknown>>): DecodoRow[] {
  const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
    }
    return undefined;
  };
  const toNumber = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const num = parseFloat(value.trim());
      return Number.isFinite(num) ? num : 0;
    }
    return 0;
  };

  const rows: DecodoRow[] = [];
  for (const raw of rawRows) {
    const text = pick(raw, ["text", "keyword", "Keyword", "term"]);
    if (typeof text !== "string" || !text.trim()) continue;
    let score = toNumber(pick(raw, ["score", "relevance", "Score"]));
    if (score > 1) score = score / 100; // auto-scale 0-100 inputs to 0-1
    const matchTypeRaw = pick(raw, ["matchType", "match_type"]);
    rows.push({
      text: normalize(text),
      score,
      matchType: matchTypeRaw === "broad" || matchTypeRaw === "phrase" || matchTypeRaw === "exact" ? matchTypeRaw : undefined,
    });
  }
  return rows;
}

/**
 * Builds candidates from Decodo export rows above the relevance threshold.
 * Branded terms (matching the book's own title/author/series) are tagged
 * brand/alpha-core; generic on-genre terms fall to genre-core/mood-setting.
 */
export function buildDecodoCandidates(
  book: { title?: string; author?: string; seriesName?: string },
  decodoData: DecodoRow[],
  options: { minScore?: number } = {}
): KeywordCandidate[] {
  const minScore = options.minScore ?? MIN_SCORE_FOR_KEEP;
  const kept = decodoData.filter((row) => row.score >= minScore);

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
    // Specificity derived from phrase length + Decodo score.
    const lengthPoints = wordCount >= 4 ? 2 : wordCount === 3 ? 1 : 0;
    const scorePoints = row.score >= 0.85 ? 2 : row.score >= 0.65 ? 1 : 0;
    const specificity = Math.max(1, Math.min(5, 2 + lengthPoints + scorePoints));

    const candidate: KeywordCandidate = {
      text: row.text,
      sources: ["decodo"],
      category,
      intentSegment,
      matchType: row.matchType,
      specificity,
    };
    return candidate;
  });
}
