import { describe, expect, it } from "vitest";
import {
  booksNeedingAttention,
  computeTargetingSummary,
  recentBooksSummary,
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

describe("computeTargetingSummary", () => {
  it("narrows each stage to a strict subset of the one before it, deduped by underlying id", () => {
    const summary = computeTargetingSummary(
      [
        { id: "k1", status: "active", lastSales: 12 },
        { id: "k2", status: "active", lastSales: 0 },
        { id: "k3", status: "rejected", lastSales: null },
      ],
      [{ id: "a1", status: "active", lastSales: null }],
      [
        // k1 selected into two campaigns — counts once.
        { keyword_id: "k1", competitor_asin_id: null, is_negative: false, state: "enabled" },
        { keyword_id: "k1", competitor_asin_id: null, is_negative: false, state: "paused" },
        { keyword_id: "k2", competitor_asin_id: null, is_negative: false, state: "enabled" },
        { keyword_id: null, competitor_asin_id: "a1", is_negative: false, state: "paused" },
        // Negative targets don't count toward selection at all.
        { keyword_id: "k3", competitor_asin_id: null, is_negative: true, state: "enabled" },
      ]
    );

    expect(summary.stages).toEqual([
      { label: "Researched", value: 4, note: "from reviews, comps, Q&A" },
      { label: "Passed relevance filter", value: 3, note: "duplicate/off-topic removed" },
      { label: "Selected into campaigns", value: 3, note: "scored + budget-fit" },
      { label: "Live on Amazon", value: 2, note: "exported & uploaded" },
    ]);
    // Live: k1 (sales 12, converting) and k2 (sales 0, not converting).
    expect(summary.liveCount).toBe(2);
    expect(summary.convertingCount).toBe(1);
    expect(summary.accuracyPct).toBe(50);
  });

  it("returns a null accuracy with no live targets yet", () => {
    const summary = computeTargetingSummary([{ id: "k1", status: "active", lastSales: null }], [], []);
    expect(summary.liveCount).toBe(0);
    expect(summary.accuracyPct).toBeNull();
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
