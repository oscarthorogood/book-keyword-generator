import { describe, expect, it } from "vitest";
import { buildUpdateReviewRows, buildUpdateUploadRows } from "../lib/campaignBulksheetExport";
import type { DiffedCampaignTarget } from "../lib/campaignDiff";

const DIFFED: DiffedCampaignTarget[] = [
  { keywordId: "kw-1", text: "term one", matchType: "exact", bid: 0.6, state: "enabled", operation: "Update" },
  { keywordId: "kw-2", text: "term two", matchType: "exact", bid: 0.4, state: "enabled", operation: "Create" },
  { keywordId: "kw-3", text: "term three", matchType: "exact", bid: 0.5, state: "archived", operation: "Archive" },
  {
    competitorAsinId: "asin-1",
    text: 'asin="B0EXAMPLE1"',
    targetingExpression: 'asin="B0EXAMPLE1"',
    bid: 0.5,
    state: "enabled",
    operation: "Update",
  },
];

describe("buildUpdateReviewRows", () => {
  it("emits one row per diffed target, no Campaign/Ad Group header rows", () => {
    const rows = buildUpdateReviewRows("My Book – Alpha Exact", "Alpha Exact", DIFFED);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.Entity === "Keyword" || r.Entity === "Product Targeting")).toBe(true);
    expect(rows.some((r) => r.Entity === "Campaign")).toBe(false);
    expect(rows.some((r) => r.Entity === "Ad Group")).toBe(false);
  });

  it("carries each target's own operation through to the row, lowercased for Create", () => {
    const rows = buildUpdateReviewRows("My Book – Alpha Exact", "Alpha Exact", DIFFED);
    const byKeyword = new Map(rows.map((r) => [r["Keyword or Product Targeting"], r.Operation]));
    expect(byKeyword.get("term one")).toBe("Update");
    expect(byKeyword.get("term two")).toBe("create");
    expect(byKeyword.get("term three")).toBe("Archive");
  });

  it("routes ASIN-backed targets to Product Targeting rows", () => {
    const rows = buildUpdateReviewRows("My Book – Rival ASIN Offensive", "Rival ASIN Offensive", DIFFED);
    const asinRow = rows.find((r) => r["Keyword or Product Targeting"] === 'asin="B0EXAMPLE1"');
    expect(asinRow?.Entity).toBe("Product Targeting");
  });
});

describe("buildUpdateUploadRows", () => {
  it("emits one row per diffed target, no Campaign/Ad Group/Product Ad rows, and no Source key", () => {
    const rows = buildUpdateUploadRows("My Book – Alpha Exact", "Alpha Exact", DIFFED);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect("Source" in row).toBe(false);
    }
    expect(rows.some((r) => r.Entity === "Product Ad")).toBe(false);
  });

  it("carries each target's own operation through unchanged (Create stays capitalized)", () => {
    const rows = buildUpdateUploadRows("My Book – Alpha Exact", "Alpha Exact", DIFFED);
    const byKeyword = new Map(rows.map((r) => [r["Keyword or Product Targeting"], r.Operation]));
    expect(byKeyword.get("term one")).toBe("Update");
    expect(byKeyword.get("term two")).toBe("Create");
    expect(byKeyword.get("term three")).toBe("Archive");
  });
});
