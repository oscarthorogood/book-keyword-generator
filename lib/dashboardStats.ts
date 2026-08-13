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
  rejected_by_filter?: string | null;
}

export interface KeywordStatsSummary {
  total: number;
  byStatus: Record<string, number>;
  byMatchType: Record<string, number>;
  bySource: Record<string, number>;
  /** Counts for specificity 1..5, plus "unscored" for rows generated before sql/09. */
  specificityDistribution: Record<Specificity | "unscored", number>;
  /** §16: which filters are rejecting the most — the tuning signal for the allowlist flow. */
  byRejectingFilter: Record<string, number>;
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
    byRejectingFilter: countBy(
      rows.filter((r) => r.rejected_by_filter),
      (r) => r.rejected_by_filter!
    ),
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

export interface CampaignSummaryCampaignRow {
  id: string;
  status: string;
}

export interface CampaignSummaryResultRow {
  campaign_id: string | null;
  spend: number | string;
  sales: number | string;
  orders: number;
  clicks: number;
  impressions: number;
  report_start: string;
  report_end: string;
}

export interface SpendPeriod {
  reportStart: string;
  reportEnd: string;
  spend: number;
  sales: number;
}

export interface CampaignSummary {
  totalCampaigns: number;
  byStatus: Record<string, number>;
  totals: { spend: number; sales: number; orders: number; clicks: number; impressions: number };
  /** Blended ACOS across every imported result period (spend / sales), null with no sales yet. */
  acos: number | null;
  /** Spend/sales grouped by report period, oldest first, for the spend-over-time widget. */
  spendByPeriod: SpendPeriod[];
}

/**
 * Cross-book campaign spend/ACOS summary — the dashboard "Campaign
 * performance" widget. Sums every `campaign_results` row the user has ever
 * imported (campaigns spec §2.3), grouped by report period for the
 * spend-over-time bars and rolled up into lifetime totals + blended ACOS.
 */
export function summarizeCampaigns(
  campaigns: CampaignSummaryCampaignRow[],
  results: CampaignSummaryResultRow[]
): CampaignSummary {
  const totals = { spend: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
  const byPeriod = new Map<string, SpendPeriod>();

  for (const r of results) {
    const spend = Number(r.spend ?? 0);
    const sales = Number(r.sales ?? 0);
    totals.spend += spend;
    totals.sales += sales;
    totals.orders += r.orders ?? 0;
    totals.clicks += r.clicks ?? 0;
    totals.impressions += r.impressions ?? 0;

    const key = `${r.report_start}_${r.report_end}`;
    const existing = byPeriod.get(key);
    if (existing) {
      existing.spend += spend;
      existing.sales += sales;
    } else {
      byPeriod.set(key, { reportStart: r.report_start, reportEnd: r.report_end, spend, sales });
    }
  }

  return {
    totalCampaigns: campaigns.length,
    byStatus: countBy(campaigns, (c) => c.status),
    totals,
    acos: totals.sales > 0 ? totals.spend / totals.sales : null,
    spendByPeriod: Array.from(byPeriod.values()).sort(
      (a, b) => new Date(a.reportStart).getTime() - new Date(b.reportStart).getTime()
    ),
  };
}

export interface AttentionBookRow {
  id: string;
  title: string;
  total_keywords: number;
  metadata_json: unknown;
}

export interface AttentionKeywordCountRow {
  book_id: string;
  status: string;
}

export interface AttentionCampaignRow {
  book_id: string;
  name: string;
  last_export_error: string | null;
}

export type AttentionReason = "capture_issue" | "no_active_keywords" | "export_failed";

export interface AttentionItem {
  bookId: string;
  bookTitle: string;
  reason: AttentionReason;
  detail: string;
}

const ATTENTION_REASON_LABEL: Record<AttentionReason, string> = {
  capture_issue: "Capture issue",
  no_active_keywords: "No active keywords",
  export_failed: "Campaign export failed",
};

/**
 * "Books needing attention" widget: flags books whose capture snapshot
 * reported a problem (lib/bookSnapshot.ts's `capture.ok`), books that have
 * keywords but none are `active` (nothing would actually get targeted), and
 * campaigns whose last export failed (`campaigns.last_export_error`, sql/28).
 * One book can surface more than once if it has more than one issue.
 */
export function booksNeedingAttention(
  books: AttentionBookRow[],
  keywordRows: AttentionKeywordCountRow[],
  campaigns: AttentionCampaignRow[]
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const bookById = new Map(books.map((b) => [b.id, b]));

  const activeCountByBook = new Map<string, number>();
  for (const row of keywordRows) {
    if (row.status !== "active") continue;
    activeCountByBook.set(row.book_id, (activeCountByBook.get(row.book_id) ?? 0) + 1);
  }

  for (const book of books) {
    const snapshot = (book.metadata_json ?? {}) as { capture?: { ok?: boolean } };
    if (snapshot.capture?.ok === false) {
      items.push({
        bookId: book.id,
        bookTitle: book.title,
        reason: "capture_issue",
        detail: ATTENTION_REASON_LABEL.capture_issue,
      });
    }
    if (book.total_keywords > 0 && (activeCountByBook.get(book.id) ?? 0) === 0) {
      items.push({
        bookId: book.id,
        bookTitle: book.title,
        reason: "no_active_keywords",
        detail: ATTENTION_REASON_LABEL.no_active_keywords,
      });
    }
  }

  for (const campaign of campaigns) {
    if (!campaign.last_export_error) continue;
    const book = bookById.get(campaign.book_id);
    items.push({
      bookId: campaign.book_id,
      bookTitle: book?.title ?? "Unknown book",
      reason: "export_failed",
      detail: `${campaign.name}: ${campaign.last_export_error}`,
    });
  }

  return items;
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
