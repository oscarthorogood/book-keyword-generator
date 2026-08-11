/**
 * Reverse-ASIN import (spec §3) — Helium 10 Cerebro-style exports of the
 * keywords a competitor ASIN ranks for organically. Free-tier-friendly:
 * accepts pre-exported rows rather than scraping Helium 10 itself.
 */

import { normalize } from "./keywordMerge";
import { manualCompetitors } from "./manualCompetitors";
import { KeywordCandidate } from "./types";

/** One normalized row from a Cerebro/reverse-ASIN export. */
export interface ReverseAsinRow {
  text: string;
  /** Estimated monthly search volume for the term. */
  volume: number;
  /** The competitor ASIN's organic rank for this term (lower is stronger). */
  rank: number;
}

/** Minimum search volume for a reverse-ASIN term to be worth a keyword slot. */
export const MIN_VOLUME_FOR_KEEP = 50;
/** Maximum organic rank (worst position) still trusted as a real ranking signal. */
export const MAX_RANK_FOR_KEEP = 306;

export function parseReverseAsinRows(rawRows: Array<Record<string, unknown>>): ReverseAsinRow[] {
  const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
    }
    return undefined;
  };
  const toNumber = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const num = parseFloat(value.replace(/,/g, "").trim());
      return Number.isFinite(num) ? num : 0;
    }
    return 0;
  };

  const rows: ReverseAsinRow[] = [];
  for (const raw of rawRows) {
    const text = pick(raw, ["Keyword Phrase", "Keyword", "text", "keyword"]);
    if (typeof text !== "string" || !text.trim()) continue;
    rows.push({
      text: normalize(text),
      volume: toNumber(pick(raw, ["Search Volume", "volume", "Exact Search Volume"])),
      rank: toNumber(pick(raw, ["Position (Rank)", "Rank", "rank", "Organic Rank"])) || Infinity,
    });
  }
  return rows;
}

/** True when the term itself names a known comp author for this book. */
function isCompAuthorTerm(text: string, asin: string | undefined, extraAuthors: string[]): boolean {
  const entry = asin ? manualCompetitors[asin] : undefined;
  const authors = [...(entry?.authors.map((a) => a.name) ?? []), ...extraAuthors];
  return authors.some((author) => text.includes(normalize(author)));
}

/** True when the term names a known comp title for this book. */
function isCompTitleTerm(text: string, asin: string | undefined, extraTitles: string[]): boolean {
  const entry = asin ? manualCompetitors[asin] : undefined;
  const titles = [...(entry?.titles ?? []), ...extraTitles];
  return titles.some((title) => text.includes(normalize(title)));
}

/**
 * Builds candidates from reverse-ASIN export rows, filtered to a reasonable
 * volume/rank threshold and classified as comp-name (author) or comp-title
 * against the book's own author and the manually curated comp library.
 */
export function buildReverseAsinCandidates(
  book: { author?: string; asin?: string },
  asinData: ReverseAsinRow[],
  options: {
    minVolume?: number;
    maxRank?: number;
    compAuthors?: string[];
    compTitles?: string[];
  } = {}
): KeywordCandidate[] {
  const minVolume = options.minVolume ?? MIN_VOLUME_FOR_KEEP;
  const maxRank = options.maxRank ?? MAX_RANK_FOR_KEEP;
  const compAuthors = options.compAuthors ?? [];
  const compTitles = options.compTitles ?? [];

  const kept = asinData.filter((row) => row.volume >= minVolume && row.rank <= maxRank);

  return kept.map((row) => {
    const isAuthorMatch =
      (book.author && row.text.includes(normalize(book.author))) ||
      isCompAuthorTerm(row.text, book.asin, compAuthors);
    const isTitleMatch = isCompTitleTerm(row.text, book.asin, compTitles);

    const category = isAuthorMatch ? "competing-authors" : isTitleMatch ? "comp-titles" : "sub-genre";
    const intentSegment = isAuthorMatch ? "comp-author" : isTitleMatch ? "comp-title" : "genre-core";
    const wordCount = row.text.split(/\s+/).filter(Boolean).length;

    const candidate: KeywordCandidate = {
      text: row.text,
      sources: ["reverse-asin"],
      category,
      intentSegment,
      matchType: isAuthorMatch || isTitleMatch ? "exact" : "phrase",
      specificity: isAuthorMatch || isTitleMatch ? 5 : wordCount >= 3 ? 4 : 3,
    };
    return candidate;
  });
}
