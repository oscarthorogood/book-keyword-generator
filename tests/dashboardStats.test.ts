import { describe, expect, it } from "vitest";
import {
  booksNeedingAttention,
  recentBooksSummary,
  summarizeCampaigns,
  summarizeKeywordStats,
  topKeywordsByGenre,
} from "../lib/dashboardStats";

describe("summarizeKeywordStats", () => {
  it("counts by status, match type, source, and specificity", () => {
    const summary = summarizeKeywordStats([
      { status: "active", match_type: "phrase", source: "autocomplete", specificity: 3 },
      { status: "active", match_type: "exact", source: "comp-name", specificity: 5 },
      { status: "rejected", match_type: "broad", source: null, specificity: null },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byStatus).toEqual({ active: 2, rejected: 1 });
    expect(summary.byMatchType).toEqual({ phrase: 1, exact: 1, broad: 1 });
    expect(summary.bySource).toEqual({ autocomplete: 1, "comp-name": 1, unknown: 1 });
    expect(summary.specificityDistribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, unscored: 1 });
  });

  it("counts by rejecting filter (§16), ignoring rows without one", () => {
    const summary = summarizeKeywordStats([
      { status: "rejected", match_type: "broad", source: null, specificity: null, rejected_by_filter: "offTopicEntity" },
      { status: "rejected", match_type: "broad", source: null, specificity: null, rejected_by_filter: "offTopicEntity" },
      { status: "active", match_type: "phrase", source: null, specificity: 3, rejected_by_filter: null },
    ]);
    expect(summary.byRejectingFilter).toEqual({ offTopicEntity: 2 });
  });
});

describe("topKeywordsByGenre", () => {
  const books = [
    { id: "b1", title: "Book One", genreTerms: ["cozy mystery"] },
    { id: "b2", title: "Book Two", genreTerms: ["epic fantasy"] },
  ];

  it("groups active keywords by each book's primary genre, ranked by specificity", () => {
    const groups = topKeywordsByGenre(books, [
      { book_id: "b1", text: "cozy mystery cat cafe", status: "active", specificity: 4 },
      { book_id: "b1", text: "amateur sleuth", status: "active", specificity: 2 },
      { book_id: "b1", text: "rejected term", status: "rejected", specificity: 5 },
      { book_id: "b2", text: "dragon rider saga", status: "active", specificity: 5 },
    ]);

    const cozy = groups.find((g) => g.genre === "cozy mystery");
    expect(cozy?.keywords.map((k) => k.text)).toEqual(["cozy mystery cat cafe", "amateur sleuth"]);

    const fantasy = groups.find((g) => g.genre === "epic fantasy");
    expect(fantasy?.keywords.map((k) => k.text)).toEqual(["dragon rider saga"]);
  });

  it("skips keywords for books with no resolved genre", () => {
    const groups = topKeywordsByGenre(
      [{ id: "b3", title: "No Genre", genreTerms: [] }],
      [{ book_id: "b3", text: "whatever", status: "active", specificity: 3 }]
    );
    expect(groups).toEqual([]);
  });
});

describe("recentBooksSummary", () => {
  it("sorts newest-first and pulls capture health from metadata_json", () => {
    const summary = recentBooksSummary([
      {
        id: "b1",
        title: "Older",
        author: "A",
        created_at: "2026-01-01T00:00:00Z",
        metadata_json: { capture: { ok: true, completeness: 0.9 } },
      },
      {
        id: "b2",
        title: "Newer",
        author: "B",
        created_at: "2026-06-01T00:00:00Z",
        metadata_json: { capture: { ok: false, completeness: 0.2 } },
      },
    ]);
    expect(summary.map((b) => b.id)).toEqual(["b2", "b1"]);
    expect(summary[0]).toMatchObject({ captureOk: false, completeness: 0.2 });
  });

  it("fails soft when metadata_json is missing (legacy row)", () => {
    const summary = recentBooksSummary([
      { id: "b1", title: "Legacy", author: "A", created_at: "2026-01-01T00:00:00Z", metadata_json: null },
    ]);
    expect(summary[0]).toMatchObject({ captureOk: null, completeness: null });
  });
});

describe("summarizeCampaigns", () => {
  it("sums totals, computes blended ACOS, and groups spend by report period", () => {
    const summary = summarizeCampaigns(
      [
        { id: "c1", status: "live" },
        { id: "c2", status: "paused" },
      ],
      [
        {
          campaign_id: "c1",
          spend: 10,
          sales: 50,
          orders: 2,
          clicks: 5,
          impressions: 100,
          report_start: "2026-01-01",
          report_end: "2026-01-07",
        },
        {
          campaign_id: "c2",
          spend: "5.50",
          sales: "20",
          orders: 1,
          clicks: 2,
          impressions: 40,
          report_start: "2026-01-01",
          report_end: "2026-01-07",
        },
        {
          campaign_id: "c1",
          spend: 20,
          sales: 0,
          orders: 0,
          clicks: 8,
          impressions: 150,
          report_start: "2026-01-08",
          report_end: "2026-01-14",
        },
      ]
    );

    expect(summary.totalCampaigns).toBe(2);
    expect(summary.byStatus).toEqual({ live: 1, paused: 1 });
    expect(summary.totals).toEqual({ spend: 35.5, sales: 70, orders: 3, clicks: 15, impressions: 290 });
    expect(summary.acos).toBeCloseTo(35.5 / 70);
    expect(summary.spendByPeriod).toEqual([
      { reportStart: "2026-01-01", reportEnd: "2026-01-07", spend: 15.5, sales: 70 },
      { reportStart: "2026-01-08", reportEnd: "2026-01-14", spend: 20, sales: 0 },
    ]);
  });

  it("returns a null ACOS with no sales", () => {
    const summary = summarizeCampaigns([{ id: "c1", status: "draft" }], []);
    expect(summary.acos).toBeNull();
    expect(summary.spendByPeriod).toEqual([]);
  });
});

describe("booksNeedingAttention", () => {
  it("flags capture issues, books with keywords but none active, and failed exports", () => {
    const items = booksNeedingAttention(
      [
        { id: "b1", title: "Flagged Capture", total_keywords: 3, metadata_json: { capture: { ok: false } } },
        { id: "b2", title: "All Paused", total_keywords: 2, metadata_json: { capture: { ok: true } } },
        { id: "b3", title: "Healthy", total_keywords: 4, metadata_json: { capture: { ok: true } } },
        { id: "b4", title: "No Keywords Yet", total_keywords: 0, metadata_json: {} },
      ],
      [
        { book_id: "b1", status: "active" },
        { book_id: "b2", status: "paused" },
        { book_id: "b2", status: "paused" },
        { book_id: "b3", status: "active" },
        { book_id: "b3", status: "active" },
      ],
      [{ book_id: "b3", name: "Alpha Exact", last_export_error: "Amazon rejected the bulksheet" }]
    );

    expect(items).toEqual(
      expect.arrayContaining([
        { bookId: "b1", bookTitle: "Flagged Capture", reason: "capture_issue", detail: "Capture issue" },
        { bookId: "b2", bookTitle: "All Paused", reason: "no_active_keywords", detail: "No active keywords" },
        {
          bookId: "b3",
          bookTitle: "Healthy",
          reason: "export_failed",
          detail: "Alpha Exact: Amazon rejected the bulksheet",
        },
      ])
    );
    expect(items).toHaveLength(3);
  });

  it("returns nothing for a clean book", () => {
    const items = booksNeedingAttention(
      [{ id: "b1", title: "Fine", total_keywords: 1, metadata_json: { capture: { ok: true } } }],
      [{ book_id: "b1", status: "active" }],
      []
    );
    expect(items).toEqual([]);
  });

  // Since generation lands every row in "archived" (PR #61), a book straight
  // out of a Generate run has keywords and nothing active. That is the normal
  // pending state, so it must not be reported as the same fault as a book
  // whose keywords are all paused/negative with nothing left to promote.
  it("names Run Filters as the next step when archived rows are waiting", () => {
    const items = booksNeedingAttention(
      [{ id: "b1", title: "Just Generated", total_keywords: 473, metadata_json: { capture: { ok: true } } }],
      [
        { book_id: "b1", status: "archived" },
        { book_id: "b1", status: "archived" },
        { book_id: "b1", status: "negative" },
      ],
      []
    );

    expect(items).toEqual([
      {
        bookId: "b1",
        bookTitle: "Just Generated",
        reason: "awaiting_filters",
        detail: "Run Filters to promote the generated keywords into the campaign pool",
      },
    ]);
  });

  it("still reports no_active_keywords when nothing is left to promote", () => {
    const items = booksNeedingAttention(
      [{ id: "b1", title: "Stuck", total_keywords: 2, metadata_json: { capture: { ok: true } } }],
      [
        { book_id: "b1", status: "paused" },
        { book_id: "b1", status: "negative" },
      ],
      []
    );

    expect(items).toEqual([
      { bookId: "b1", bookTitle: "Stuck", reason: "no_active_keywords", detail: "No active keywords" },
    ]);
  });
});
