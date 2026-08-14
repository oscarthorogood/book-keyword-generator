/**
 * Pure aggregation functions behind the dashboard widgets (Enhancements
 * spec §2). Each widget's API route fetches the relevant rows and hands
 * them here — kept separate from the routes so the aggregation logic is
 * unit-testable without a database.
 */

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
  coverImageUrl?: string;
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
    const snapshot = (book.metadata_json ?? {}) as { coverImageUrl?: string; capture?: { ok?: boolean } };
    if (snapshot.capture?.ok === false) {
      items.push({
        bookId: book.id,
        bookTitle: book.title,
        reason: "capture_issue",
        detail: ATTENTION_REASON_LABEL.capture_issue,
        coverImageUrl: snapshot.coverImageUrl,
      });
    }
    if (!booksWithCampaigns.has(book.id)) {
      items.push({
        bookId: book.id,
        bookTitle: book.title,
        reason: "no_campaigns",
        detail: ATTENTION_REASON_LABEL.no_campaigns,
        coverImageUrl: snapshot.coverImageUrl,
      });
    }
  }

  for (const campaign of campaigns) {
    if (!campaign.last_export_error) continue;
    const book = bookById.get(campaign.book_id);
    const snapshot = (book?.metadata_json ?? {}) as { coverImageUrl?: string };
    items.push({
      bookId: campaign.book_id,
      bookTitle: book?.title ?? "Unknown book",
      reason: "export_failed",
      detail: `${campaign.name}: ${campaign.last_export_error}`,
      coverImageUrl: snapshot.coverImageUrl,
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

export interface TargetingSourceRow {
  id: string;
  status: string;
  /** keywords.last_sales / competitor_asins.last_sales — cached from the latest results import (sql/24). */
  lastSales: number | string | null;
}

export interface TargetingTargetRow {
  keyword_id: string | null;
  competitor_asin_id: string | null;
  is_negative: boolean;
  state: string;
}

export interface TargetingFunnelStage {
  label: string;
  value: number;
  note: string;
}

export interface TargetingSummary {
  stages: TargetingFunnelStage[];
  /** Share of live targets that converted at least one sale, 0-100; null with no live targets yet. */
  accuracyPct: number | null;
  convertingCount: number;
  liveCount: number;
}

/**
 * The "Keyword & ASIN funnel" + "Targeting accuracy" widgets (Dashboard,
 * Book detail): how far research narrows down to what's actually live, and
 * how much of what's live is working. Every stage is a strict subset of the
 * one before it, deduped by the underlying keyword/ASIN id since the same
 * target can be selected into more than one campaign.
 */
export function computeTargetingSummary(
  keywords: TargetingSourceRow[],
  competitorAsins: TargetingSourceRow[],
  targets: TargetingTargetRow[]
): TargetingSummary {
  const sources = [...keywords, ...competitorAsins];
  const salesById = new Map(sources.map((s) => [s.id, Number(s.lastSales ?? 0)]));

  const researched = sources.length;
  const passedFilter = sources.filter((s) => s.status === "active").length;

  const idOf = (t: TargetingTargetRow) => t.keyword_id ?? t.competitor_asin_id;
  const positiveTargets = targets.filter((t) => !t.is_negative);
  const selectedIds = new Set(positiveTargets.map(idOf).filter((id): id is string => !!id));
  const liveIds = new Set(
    positiveTargets
      .filter((t) => t.state === "enabled")
      .map(idOf)
      .filter((id): id is string => !!id)
  );

  const liveCount = liveIds.size;
  const convertingCount = Array.from(liveIds).filter((id) => (salesById.get(id) ?? 0) > 0).length;

  return {
    stages: [
      { label: "Researched", value: researched, note: "from reviews, comps, Q&A" },
      { label: "Passed relevance filter", value: passedFilter, note: "duplicate/off-topic removed" },
      { label: "Selected into campaigns", value: selectedIds.size, note: "scored + budget-fit" },
      { label: "Live on Amazon", value: liveCount, note: "exported & uploaded" },
    ],
    accuracyPct: liveCount > 0 ? Math.round((convertingCount / liveCount) * 100) : null,
    convertingCount,
    liveCount,
  };
}
