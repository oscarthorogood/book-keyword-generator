/**
 * Aggregation behind the "All Competitors" page (competitor-ASIN
 * enhancements task 3) — every competitor ASIN tracked across every one of
 * the user's books, grouped by ASIN so the same competitor tracked on three
 * books shows up once with a Books column instead of three times. Mirrors
 * lib/allKeywordsAggregate.ts's aggregateKeywordsAcrossBooks() exactly,
 * grouping by ASIN instead of keyword text.
 */

export interface AllCompetitorsSourceRow {
  book_id: string;
  book_title: string;
  book_author: string | null;
  competitor_asin: string;
  source: string;
  status: string;
  bid: number | null;
  title: string | null;
  author: string | null;
  price: number | null;
  bsr: number | null;
  competitor_count: number | null;
  mean_rank: number | null;
}

export interface AggregatedCompetitorBook {
  bookId: string;
  bookTitle: string;
  bookAuthor: string | null;
  status: string;
  bid: number | null;
}

export interface AggregatedCompetitorRow {
  /** Grouping key: uppercased ASIN. */
  key: string;
  /** Display ASIN. */
  competitorAsin: string;
  /** Best-effort product title, first non-null seen across the group. */
  title: string | null;
  /** Best-effort author, first non-null seen across the group. */
  author: string | null;
  /** Best-effort price, first non-null seen across the group. */
  price: number | null;
  /** Best-effort best-seller rank, first non-null seen across the group. */
  bsr: number | null;
  books: AggregatedCompetitorBook[];
  statuses: string[];
  sources: string[];
  /** Highest recorded discovery-source count for this ASIN across books. */
  maxCompetitorCount: number | null;
}

function normalize(asin: string): string {
  return asin.toUpperCase().trim();
}

function uniqueSorted<T>(values: T[]): T[] {
  return Array.from(new Set(values)).sort();
}

function firstNonNull<T>(values: Array<T | null>): T | null {
  return values.find((v): v is T => v !== null && v !== undefined) ?? null;
}

export function aggregateCompetitorsAcrossBooks(rows: AllCompetitorsSourceRow[]): AggregatedCompetitorRow[] {
  const byKey = new Map<string, AllCompetitorsSourceRow[]>();
  for (const row of rows) {
    const key = normalize(row.competitor_asin);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  return Array.from(byKey.entries())
    .map(([key, groupRows]) => {
      const competitorCounts = groupRows
        .map((r) => r.competitor_count)
        .filter((c): c is number => c !== null && c !== undefined);
      return {
        key,
        competitorAsin: groupRows[0].competitor_asin,
        title: firstNonNull(groupRows.map((r) => r.title)),
        author: firstNonNull(groupRows.map((r) => r.author)),
        price: firstNonNull(groupRows.map((r) => r.price)),
        bsr: firstNonNull(groupRows.map((r) => r.bsr)),
        books: groupRows.map((r) => ({
          bookId: r.book_id,
          bookTitle: r.book_title,
          bookAuthor: r.book_author,
          status: r.status,
          bid: r.bid,
        })),
        statuses: uniqueSorted(groupRows.map((r) => r.status)),
        sources: uniqueSorted(groupRows.map((r) => r.source)),
        maxCompetitorCount: competitorCounts.length ? Math.max(...competitorCounts) : null,
      };
    })
    .sort((a, b) => b.books.length - a.books.length || a.competitorAsin.localeCompare(b.competitorAsin));
}
