import { describe, expect, it } from "vitest";
import {
  booksNeedingAttention,
  recentBooksSummary,
  summarizeCampaigns,
} from "../lib/dashboardStats";

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
  it("flags capture issues, books with no campaigns, and failed exports", () => {
    const items = booksNeedingAttention(
      [
        { id: "b1", title: "Flagged Capture", metadata_json: { capture: { ok: false } } },
        { id: "b2", title: "No Campaigns", metadata_json: { capture: { ok: true } } },
        { id: "b3", title: "Healthy", metadata_json: { capture: { ok: true } } },
      ],
      [
        { book_id: "b1", name: "Brand Guard", last_export_error: null },
        { book_id: "b3", name: "Alpha Exact", last_export_error: "Amazon rejected the bulksheet" },
      ]
    );

    expect(items).toEqual(
      expect.arrayContaining([
        { bookId: "b1", bookTitle: "Flagged Capture", reason: "capture_issue", detail: "Capture issue" },
        { bookId: "b2", bookTitle: "No Campaigns", reason: "no_campaigns", detail: "No campaigns yet" },
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

  it("returns nothing for a book with a clean capture and at least one campaign", () => {
    const items = booksNeedingAttention(
      [{ id: "b1", title: "Fine", metadata_json: { capture: { ok: true } } }],
      [{ book_id: "b1", name: "Alpha Exact", last_export_error: null }]
    );
    expect(items).toEqual([]);
  });

  // Keyword status is no longer a reason to flag a book: the bank is filled
  // and filtered inside Create Campaigns, so "nothing active" is either
  // brand new or already handled, and there is no button to point the user
  // at. A book with campaigns is a book that worked.
  it("does not flag a book with campaigns, whatever its keyword statuses are", () => {
    const items = booksNeedingAttention(
      [{ id: "b1", title: "Just Generated", metadata_json: { capture: { ok: true } } }],
      [{ book_id: "b1", name: "BMM Discovery", last_export_error: null }]
    );
    expect(items).toEqual([]);
  });

  it("flags a brand-new book once, for having no campaigns", () => {
    const items = booksNeedingAttention([{ id: "b1", title: "Brand New", metadata_json: { capture: { ok: true } } }], []);
    expect(items).toEqual([
      { bookId: "b1", bookTitle: "Brand New", reason: "no_campaigns", detail: "No campaigns yet" },
    ]);
  });
});
