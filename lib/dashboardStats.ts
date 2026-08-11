/**
 * Pure aggregation functions behind the dashboard widgets (Enhancements
 * spec §2). Each widget's API route fetches the relevant rows and hands
 * them here — kept separate from the routes so the aggregation logic is
 * unit-testable without a database.
 */

import type { Specificity } from "./keywordSpecificity";

export interface KeywordStatsRow {
  status: string;
  match_type: string;
  source: string | null;
  specificity: number | null;
}

export interface KeywordStatsSummary {
  total: number;
  byStatus: Record<string, number>;
  byMatchType: Record<string, number>;
  bySource: Record<string, number>;
  /** Counts for specificity 1..5, plus "unscored" for rows generated before sql/09. */
  specificityDistribution: Record<Specificity | "unscored", number>;
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
}

/**
 * Keyword totals by status/match-type/source, and the specificity (§1)
 * distribution — the dashboard's "Keyword stats" and "Specificity
 * distribution" widgets. Rejected keywords are counted (they're research
 * exhaust, not hidden) since the point of this widget is generate-run
 * visibility, not just the working list.
 */
export function summarizeKeywordStats(rows: KeywordStatsRow[]): KeywordStatsSummary {
  const specificityDistribution: KeywordStatsSummary["specificityDistribution"] = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    unscored: 0,
  };
  for (const row of rows) {
    if (row.specificity && row.specificity >= 1 && row.specificity <= 5) {
      specificityDistribution[row.specificity as Specificity] += 1;
    } else {
      specificityDistribution.unscored += 1;
    }
  }

  return {
    total: rows.length,
    byStatus: countBy(rows, (r) => r.status),
    byMatchType: countBy(rows, (r) => r.match_type),
    bySource: countBy(rows, (r) => r.source ?? "unknown"),
    specificityDistribution,
  };
}

export interface GenreKeywordSourceRow {
  book_id: string;
  text: string;
  status: string;
  specificity: number | null;
}

export interface BookGenreRow {
  id: string;
  title: string;
  /** books.metadata_json.genreTerms — the same resolved vocabulary lib/genre.ts produces. */
  genreTerms: string[];
}

export interface TopKeywordEntry {
  text: string;
  bookId: string;
  bookTitle: string;
  specificity: number | null;
}

export interface GenreKeywordGroup {
  genre: string;
  keywords: TopKeywordEntry[];
}

/**
 * Top active keywords grouped by each book's resolved genre (its first
 * `genreTerms` entry — the same primary genre lib/genre.ts resolves).
 * "Top" ranks by specificity, the closest persisted proxy to confidence —
 * the pipeline's per-candidate `score` isn't written to the keywords table,
 * only bid/specificity/category survive to storage.
 */
export function topKeywordsByGenre(
  books: BookGenreRow[],
  keywordRows: GenreKeywordSourceRow[],
  perGenre = 5
): GenreKeywordGroup[] {
  const genreByBook = new Map<string, { genre: string; title: string }>();
  for (const book of books) {
    const genre = book.genreTerms[0];
    if (genre) genreByBook.set(book.id, { genre, title: book.title });
  }

  const byGenre = new Map<string, TopKeywordEntry[]>();
  for (const row of keywordRows) {
    if (row.status !== "active") continue;
    const info = genreByBook.get(row.book_id);
    if (!info) continue;
    const entry: TopKeywordEntry = {
      text: row.text,
      bookId: row.book_id,
      bookTitle: info.title,
      specificity: row.specificity,
    };
    if (!byGenre.has(info.genre)) byGenre.set(info.genre, []);
    byGenre.get(info.genre)!.push(entry);
  }

  return Array.from(byGenre.entries())
    .map(([genre, keywords]) => ({
      genre,
      keywords: keywords
        .sort((a, b) => (b.specificity ?? 0) - (a.specificity ?? 0))
        .slice(0, perGenre),
    }))
    .sort((a, b) => b.keywords.length - a.keywords.length);
}

export interface RecentBookRow {
  id: string;
  title: string;
  author: string;
  created_at: string;
  /** books.metadata_json — read loosely since older rows predate the snapshot shape. */
  metadata_json: unknown;
}

export interface RecentBookSummary {
  id: string;
  title: string;
  author: string;
  createdAt: string;
  coverImageUrl?: string;
  /** Reuses the snapshot's own capture-health fields rather than a new score. */
  captureOk: boolean | null;
  completeness: number | null;
}

/**
 * Recent-books widget rows. Deliberately reuses the `capture.ok` /
 * `capture.completeness` fields already computed and persisted per book in
 * lib/bookSnapshot.ts, rather than inventing a parallel health score.
 */
export function recentBooksSummary(books: RecentBookRow[], limit = 5): RecentBookSummary[] {
  return books
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)
    .map((book) => {
      const snapshot = (book.metadata_json ?? {}) as {
        coverImageUrl?: string;
        capture?: { ok?: boolean; completeness?: number };
      };
      return {
        id: book.id,
        title: book.title,
        author: book.author,
        createdAt: book.created_at,
        coverImageUrl: snapshot.coverImageUrl,
        captureOk: snapshot.capture?.ok ?? null,
        completeness: snapshot.capture?.completeness ?? null,
      };
    });
}
