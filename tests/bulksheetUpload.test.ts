import { describe, expect, it } from "vitest";
import { buildUploadRows } from "../lib/bulksheetUpload";
import type { BulksheetInput } from "../lib/bulksheet";

const BASE_INPUT: BulksheetInput = {
  bookTitle: "My Cozy Mystery",
  sku: "B0EXAMPLE1",
  keywords: [
    { text: "cozy mystery series", matchType: "phrase", bid: 0.6, status: "active", source: "listing-metadata" },
    { text: "jane doe mysteries", matchType: "exact", bid: 0.7, status: "active", group: "comp-names" },
  ],
  negatives: [{ text: "textbook", matchType: "phrase", reason: "offTopicEntity" }],
  productTargets: [{ asin: "B0EXAMPLE2", score: 0.8, title: "Comparable Title" }],
};

describe("buildUploadRows (campaigns spec §1.1/§8 PR 3b)", () => {
  it("throws without a sku — Amazon has nothing to advertise without a Product Ad row", () => {
    expect(() => buildUploadRows({ ...BASE_INPUT, sku: undefined })).toThrow(/sku/i);
  });

  it("inserts one Product Ad row per ad group, right after that ad group's row", () => {
    const rows = buildUploadRows(BASE_INPUT);
    const adGroupIndexes = rows
      .map((row, i) => (row.Entity === "Ad Group" ? i : -1))
      .filter((i) => i !== -1);

    expect(adGroupIndexes.length).toBeGreaterThan(0);
    for (const i of adGroupIndexes) {
      const productAd = rows[i + 1];
      expect(productAd.Entity).toBe("Product Ad");
      expect(productAd.SKU).toBe("B0EXAMPLE1");
      expect(productAd["Campaign Name"]).toBe(rows[i]["Campaign Name"]);
      expect(productAd["Ad Group Name"]).toBe(rows[i]["Ad Group Name"]);
    }
  });

  it("every row uses Operation 'Create' and no row has a Source key", () => {
    const rows = buildUploadRows(BASE_INPUT);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.Operation).toBe("Create");
      expect("Source" in row).toBe(false);
    }
  });

  it("negative rows use the camelCase negativePhrase/negativeExact codes", () => {
    const rows = buildUploadRows(BASE_INPUT);
    const negativeRows = rows.filter((row) => row.Entity === "Negative Keyword");
    expect(negativeRows.length).toBeGreaterThan(0);
    for (const row of negativeRows) {
      expect(["negativePhrase", "negativeExact"]).toContain(row["Match Type"]);
    }
  });

  it("every Keyword/Product Targeting row's Campaign/Ad Group Name resolves to a Campaign/Ad Group row in the same file (no orphans)", () => {
    const rows = buildUploadRows(BASE_INPUT);
    const campaignNames = new Set(rows.filter((r) => r.Entity === "Campaign").map((r) => r["Campaign Name"]));
    const adGroupKeys = new Set(
      rows.filter((r) => r.Entity === "Ad Group").map((r) => `${r["Campaign Name"]}::${r["Ad Group Name"]}`)
    );

    for (const row of rows) {
      if (row.Entity === "Campaign") continue;
      expect(campaignNames.has(row["Campaign Name"])).toBe(true);
      expect(adGroupKeys.has(`${row["Campaign Name"]}::${row["Ad Group Name"]}`)).toBe(true);
    }
  });

  it("produces no rows for an empty book", () => {
    const rows = buildUploadRows({ bookTitle: "Empty Book", sku: "B0EXAMPLE1", keywords: [] });
    expect(rows).toEqual([]);
  });
});
