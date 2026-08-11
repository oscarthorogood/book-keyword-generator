/**
 * Cross-book keyword cannibalization (Enhancements spec §14): the same
 * keyword active on 2+ books competes against itself in Amazon's auction.
 * Built on §4's aggregation (lib/allKeywordsAggregate.ts) rather than a
 * parallel query.
 */

import type { AggregatedKeywordBook, AggregatedKeywordRow } from "./allKeywordsAggregate";

/**
 * Same-author books legitimately share author-name keywords ("cathy
 * hayward" on every Cathy Hayward title is brand defense, not
 * cannibalization) — exempt a row where every active instance is by the
 * same author.
 */
function isSameAuthorOnly(activeBooks: AggregatedKeywordBook[]): boolean {
  const authors = new Set(activeBooks.map((b) => (b.bookAuthor ?? "").trim().toLowerCase()).filter(Boolean));
  return authors.size === 1 && activeBooks.every((b) => b.bookAuthor);
}

/** A row is cannibalized when 2+ *distinct* books both run it active, and it isn't a same-author brand-defense term. */
export function isCannibalized(row: AggregatedKeywordRow): boolean {
  const activeBooks = row.books.filter((b) => b.status === "active");
  const distinctBookIds = new Set(activeBooks.map((b) => b.bookId));
  if (distinctBookIds.size < 2) return false;
  return !isSameAuthorOnly(activeBooks);
}

export function findCannibalizedKeywords(rows: AggregatedKeywordRow[]): AggregatedKeywordRow[] {
  return rows.filter(isCannibalized);
}

/**
 * Which book should "own" a cannibalized keyword: highest specificity
 * (this book's copy is the most targeted match for the phrase), tie-broken
 * by highest bid (already-invested confidence). §6 performance data would
 * be the ideal signal but doesn't exist yet in this tree — see the
 * Enhancements spec §0.1 grounding note on search-term ingestion.
 */
export function suggestOwner(row: AggregatedKeywordRow): AggregatedKeywordBook | null {
  const activeBooks = row.books.filter((b) => b.status === "active");
  if (activeBooks.length === 0) return null;
  return activeBooks.reduce((best, candidate) => {
    const bestScore = best.specificity ?? 0;
    const candidateScore = candidate.specificity ?? 0;
    if (candidateScore !== bestScore) return candidateScore > bestScore ? candidate : best;
    return (candidate.bid ?? 0) > (best.bid ?? 0) ? candidate : best;
  });
}

/** The other active books that should be paused once one is chosen as owner. */
export function othersToPause(row: AggregatedKeywordRow, ownerBookId: string): AggregatedKeywordBook[] {
  return row.books.filter((b) => b.status === "active" && b.bookId !== ownerBookId);
}
