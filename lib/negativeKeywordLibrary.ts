/**
 * Shared negative-keyword library (Enhancements spec §15): negatives
 * scoped global / per-genre / per-book, merged with a book's own generated
 * negatives at export time.
 */

import { fitNegativeMatchType, type NegativeKeyword } from "./negativeKeywords";

export type NegativeScope = "global" | "genre" | "book";

export interface LibraryNegativeRow {
  keyword: string;
  matchType: "phrase" | "exact";
  scope: NegativeScope;
  genreId: string | null;
  bookId: string | null;
  reason: string | null;
}

/**
 * Which library negatives apply to a given book export: every global row,
 * every genre row whose genre matched this book (the same match set
 * `matchGenresToBook` produces for presets), and every book-scoped row for
 * this exact book.
 */
export function selectApplicableNegatives(
  rows: LibraryNegativeRow[],
  bookId: string,
  matchedGenreIds: Set<string>
): LibraryNegativeRow[] {
  return rows.filter((row) => {
    if (row.scope === "global") return true;
    if (row.scope === "genre") return row.genreId !== null && matchedGenreIds.has(row.genreId);
    return row.bookId === bookId;
  });
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

/**
 * Merges a book's own generated negatives with the library negatives that
 * apply to it, deduped by text (case-insensitive) — the book's own
 * negative wins on a collision since it carries the more specific reason.
 *
 * Library rows are typed in by hand and stored verbatim, so they get the
 * same word-count clamp the generated ones do (lib/negativeKeywords.ts): a
 * phrase row over Amazon's 4-word limit is narrowed to exact, and a row too
 * long for either is skipped rather than exported as a row that fails on
 * upload.
 */
export function mergeNegatives(
  bookNegatives: NegativeKeyword[],
  libraryNegatives: LibraryNegativeRow[]
): NegativeKeyword[] {
  const merged = new Map<string, NegativeKeyword>();
  for (const negative of bookNegatives) {
    merged.set(normalize(negative.text), negative);
  }
  for (const row of libraryNegatives) {
    const key = normalize(row.keyword);
    if (merged.has(key)) continue;
    const matchType = fitNegativeMatchType(normalize(row.keyword), row.matchType);
    if (!matchType) continue;
    merged.set(key, { text: row.keyword, matchType, reason: row.reason ?? `${row.scope} negative` });
  }
  return Array.from(merged.values());
}

/**
 * A negative that matches one of a book's own active keywords would
 * suppress traffic the book actually wants — surfaced as a warning when
 * promoting a rejection to the library, never silently applied.
 */
export function findNegativeCollisions(keyword: string, activeKeywordTexts: Iterable<string>): string[] {
  const target = normalize(keyword);
  const collisions: string[] = [];
  for (const text of activeKeywordTexts) {
    if (normalize(text) === target) collisions.push(text);
  }
  return collisions;
}
