/**
 * Aggregation behind the "All Keywords" page (Enhancements spec §4): every
 * keyword generated across every one of the user's books, grouped by text
 * so the same phrase active on three books shows up once with a Books
 * column instead of three times.
 *
 * Grouped by exact lowercased text — the spec explicitly allows this for
 * v1 ("exact text grouping is acceptable") rather than the near-duplicate
 * signature the generation-time dedup in lib/keywordMerge.ts uses, which is
 * tuned for collapsing generation candidates, not for display grouping.
 */

export interface AllKeywordsSourceRow {
  book_id: string;
  book_title: string;
  book_author: string | null;
  text: string;
  status: string;
  match_type: string;
  source: string | null;
  specificity: number | null;
  bid: number | null;
}

export interface AggregatedKeywordBook {
  bookId: string;
  bookTitle: string;
  bookAuthor: string | null;
  status: string;
  specificity: number | null;
  bid: number | null;
}

export interface AggregatedKeywordRow {
  /** Grouping key: lowercased, trimmed text. */
  key: string;
  /** Display text — the first-seen casing. */
  text: string;
  books: AggregatedKeywordBook[];
  statuses: string[];
  matchTypes: string[];
  sources: string[];
  specificities: number[];
  maxSpecificity: number | null;
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function uniqueSorted<T>(values: T[]): T[] {
  return Array.from(new Set(values)).sort();
}

export function aggregateKeywordsAcrossBooks(rows: AllKeywordsSourceRow[]): AggregatedKeywordRow[] {
  const byKey = new Map<string, AllKeywordsSourceRow[]>();
  for (const row of rows) {
    const key = normalize(row.text);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(row);
  }

  return Array.from(byKey.entries())
    .map(([key, groupRows]) => {
      const specificities = groupRows
        .map((r) => r.specificity)
        .filter((s): s is number => s !== null && s !== undefined);
      return {
        key,
        text: groupRows[0].text,
        books: groupRows.map((r) => ({
          bookId: r.book_id,
          bookTitle: r.book_title,
          bookAuthor: r.book_author,
          status: r.status,
          specificity: r.specificity,
          bid: r.bid,
        })),
        statuses: uniqueSorted(groupRows.map((r) => r.status)),
        matchTypes: uniqueSorted(groupRows.map((r) => r.match_type)),
        sources: uniqueSorted(groupRows.map((r) => r.source ?? "unknown")),
        specificities,
        maxSpecificity: specificities.length ? Math.max(...specificities) : null,
      };
    })
    .sort((a, b) => b.books.length - a.books.length || a.text.localeCompare(b.text));
}
