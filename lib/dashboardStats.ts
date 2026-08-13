/**
 * Pure aggregation functions behind the dashboard widgets (Enhancements
 * spec §2). Each widget's API route fetches the relevant rows and hands
 * them here — kept separate from the routes so the aggregation logic is
 * unit-testable without a database.
 */

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    counts[k] = (counts[k] ?? 0) + 1;
  }
  return counts;
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
  metadata_json: unknown;
}

export interface AttentionCampaignRow {
  book_id: string;
  name: string;
  last_export_error: string | null;
}

export type AttentionReason = "capture_issue" | "no_campaigns" | "export_failed";

export interface AttentionItem {
  bookId: string;
  bookTitle: string;
  reason: AttentionReason;
  detail: string;
}

const ATTENTION_REASON_LABEL: Record<AttentionReason, string> = {
  capture_issue: "Capture issue",
  no_campaigns: "No campaigns yet",
  export_failed: "Campaign export failed",
};

/**
 * "Books needing attention" widget: flags books whose capture snapshot
 * reported a problem (lib/bookSnapshot.ts's `capture.ok`), books with no
 * campaigns yet, and campaigns whose last export failed
 * (`campaigns.last_export_error`, sql/28). One book can surface more than
 * once if it has more than one issue.
 *
 * This used to flag books by keyword status — "No active keywords", or
 * "Run Filters to promote the generated keywords into the campaign pool".
 * Neither is something the user can act on any more: the bank is filled and
 * filtered server-side inside Create Campaigns (lib/campaignPrepare.ts), so
 * a book with nothing active is either brand new or already handled. What
 * is worth surfacing is the campaign-level fact — this book has no
 * campaigns — which is one press away from fixed.
 */
export function booksNeedingAttention(
  books: AttentionBookRow[],
  campaigns: AttentionCampaignRow[]
): AttentionItem[] {
  const items: AttentionItem[] = [];
  const bookById = new Map(books.map((b) => [b.id, b]));
  const booksWithCampaigns = new Set(campaigns.map((c) => c.book_id));

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
    if (!booksWithCampaigns.has(book.id)) {
      items.push({
        bookId: book.id,
        bookTitle: book.title,
        reason: "no_campaigns",
        detail: ATTENTION_REASON_LABEL.no_campaigns,
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
