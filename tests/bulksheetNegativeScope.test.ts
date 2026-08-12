import { describe, expect, it } from "vitest";
import { buildBulksheetRows, type BulksheetInput } from "../lib/bulksheet";
import { buildUploadRows } from "../lib/bulksheetUpload";

// Campaigns spec §1.3 / §8 PR 4: negatives carry a campaign/ad_group scope,
// and the bulksheet builders route each to the right entity row.

const BASE_INPUT: BulksheetInput = {
  bookTitle: "My Cozy Mystery",
  sku: "B0EXAMPLE1",
  keywords: [{ text: "cozy mystery series", matchType: "phrase", bid: 0.6, status: "active" }],
};

describe("negative scope routing", () => {
  it("review CSV: an ad_group-scoped negative (or one with no scope) emits a Negative Keyword row with an Ad Group Name", () => {
    const rows = buildBulksheetRows({
      ...BASE_INPUT,
      negatives: [{ text: "textbook", matchType: "phrase", reason: "offTopicEntity", scope: "ad_group" }],
    });
    const negativeRows = rows.filter((r) => r.Entity === "Negative Keyword");
    expect(negativeRows.length).toBeGreaterThan(0);
    for (const row of negativeRows) {
      expect(row["Ad Group Name"]).not.toBe("");
    }
    expect(rows.some((r) => r.Entity === "Campaign Negative Keyword")).toBe(false);
  });

  it("review CSV: an unscoped negative defaults to ad_group (today's behaviour, unchanged)", () => {
    const rows = buildBulksheetRows({
      ...BASE_INPUT,
      negatives: [{ text: "textbook", matchType: "phrase", reason: "offTopicEntity" }],
    });
    expect(rows.some((r) => r.Entity === "Negative Keyword")).toBe(true);
    expect(rows.some((r) => r.Entity === "Campaign Negative Keyword")).toBe(false);
  });

  it("review CSV: a campaign-scoped negative emits a Campaign Negative Keyword row with no Ad Group Name", () => {
    const rows = buildBulksheetRows({
      ...BASE_INPUT,
      negatives: [{ text: "some alpha term", matchType: "exact", reason: "promoted to Alpha Exact", scope: "campaign" }],
    });
    const campaignNegativeRows = rows.filter((r) => r.Entity === "Campaign Negative Keyword");
    expect(campaignNegativeRows.length).toBeGreaterThan(0);
    for (const row of campaignNegativeRows) {
      expect(row["Ad Group Name"]).toBe("");
      expect(row["Campaign Name"]).not.toBe("");
    }
    expect(rows.some((r) => r.Entity === "Negative Keyword")).toBe(false);
  });

  it("upload xlsx rows: campaign-scoped negatives use the camelCase match code and no Ad Group Name/Source", () => {
    const rows = buildUploadRows({
      ...BASE_INPUT,
      negatives: [{ text: "some alpha term", matchType: "exact", reason: "promoted to Alpha Exact", scope: "campaign" }],
    });
    const campaignNegativeRows = rows.filter((r) => r.Entity === "Campaign Negative Keyword");
    expect(campaignNegativeRows.length).toBeGreaterThan(0);
    for (const row of campaignNegativeRows) {
      expect(row["Ad Group Name"]).toBe("");
      expect(row["Match Type"]).toBe("negativeExact");
      expect(row.Operation).toBe("Create");
      expect("Source" in row).toBe(false);
    }
  });

  it("upload xlsx rows: ad_group-scoped (or unscoped) negatives keep going out as Negative Keyword", () => {
    const rows = buildUploadRows({
      ...BASE_INPUT,
      negatives: [{ text: "textbook", matchType: "phrase", reason: "offTopicEntity" }],
    });
    expect(rows.some((r) => r.Entity === "Negative Keyword")).toBe(true);
    expect(rows.some((r) => r.Entity === "Campaign Negative Keyword")).toBe(false);
  });
});
