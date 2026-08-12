import { describe, expect, it } from "vitest";
import {
  BULKSHEET_UPLOAD_COLUMNS,
  buildProductAdRow,
  buildUploadAdGroupRow,
  buildUploadCampaignRow,
  buildUploadKeywordRow,
  buildUploadNegativeKeywordRow,
  buildUploadProductTargetingRow,
  negativeMatchTypeCode,
  PRODUCT,
} from "../lib/bulksheetSchema";

describe("bulksheetSchema upload row builders (campaigns spec §1.1/§8 PR 3)", () => {
  it("BULKSHEET_UPLOAD_COLUMNS drops Source and adds SKU, otherwise matches the review column set", () => {
    expect(BULKSHEET_UPLOAD_COLUMNS).toEqual([
      "Product",
      "Entity",
      "Operation",
      "Campaign Name",
      "Ad Group Name",
      "SKU",
      "Keyword or Product Targeting",
      "Match Type",
      "Bid",
      "Daily Budget",
      "Campaign Targeting Type",
      "State",
    ]);
  });

  it("every upload row builder only ever uses keys from BULKSHEET_UPLOAD_COLUMNS", () => {
    const rows = [
      buildUploadCampaignRow({ name: "Book – Descriptive", dailyBudget: 25, targetingType: "manual" }),
      buildUploadAdGroupRow({ campaign: "Book – Descriptive", adGroup: "Descriptive", bid: 0.5 }),
      buildProductAdRow({ campaign: "Book – Descriptive", adGroup: "Descriptive", sku: "B0EXAMPLE1" }),
      buildUploadKeywordRow({
        campaign: "Book – Descriptive",
        adGroup: "Descriptive",
        text: "cozy mystery",
        matchType: "phrase",
        bid: 0.6,
        defaultBid: 0.5,
        status: "active",
      }),
      buildUploadNegativeKeywordRow({
        campaign: "Book – Descriptive",
        adGroup: "Descriptive",
        text: "textbook",
        matchType: "phrase",
      }),
      buildUploadProductTargetingRow({
        campaign: "Book – Product Targeting",
        adGroup: "ASIN & brand targets",
        targetingExpression: 'asin="B0EXAMPLE2"',
        bid: 0.5,
      }),
    ];

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...BULKSHEET_UPLOAD_COLUMNS].sort());
    }
  });

  it("every upload row builder writes Operation as 'Create', not lowercase 'create'", () => {
    const rows = [
      buildUploadCampaignRow({ name: "x", dailyBudget: 25, targetingType: "manual" }),
      buildUploadAdGroupRow({ campaign: "x", adGroup: "y", bid: 0.5 }),
      buildProductAdRow({ campaign: "x", adGroup: "y", sku: "B0EXAMPLE1" }),
      buildUploadKeywordRow({ campaign: "x", adGroup: "y", text: "t", matchType: "phrase", bid: 0.5, defaultBid: 0.5 }),
      buildUploadNegativeKeywordRow({ campaign: "x", adGroup: "y", text: "t", matchType: "phrase" }),
      buildUploadProductTargetingRow({ campaign: "x", adGroup: "y", targetingExpression: "e", bid: 0.5 }),
    ];
    for (const row of rows) {
      expect(row.Operation).toBe("Create");
    }
  });

  it("buildProductAdRow carries the SKU and no keyword/targeting text", () => {
    const row = buildProductAdRow({ campaign: "My Book – Descriptive", adGroup: "Descriptive", sku: "B0EXAMPLE1" });
    expect(row).toMatchObject({
      Product: PRODUCT,
      Entity: "Product Ad",
      Operation: "Create",
      "Campaign Name": "My Book – Descriptive",
      "Ad Group Name": "Descriptive",
      SKU: "B0EXAMPLE1",
      State: "enabled",
    });
  });

  describe("negativeMatchTypeCode", () => {
    it("maps phrase and exact to Amazon's camelCase negative codes", () => {
      expect(negativeMatchTypeCode("phrase")).toBe("negativePhrase");
      expect(negativeMatchTypeCode("exact")).toBe("negativeExact");
    });
  });

  it("buildUploadNegativeKeywordRow writes the camelCase negative match type, not 'negative phrase'", () => {
    const row = buildUploadNegativeKeywordRow({
      campaign: "My Book – Descriptive",
      adGroup: "Descriptive",
      text: "textbook",
      matchType: "phrase",
    });
    expect(row["Match Type"]).toBe("negativePhrase");
  });

  it("buildUploadKeywordRow and buildUploadProductTargetingRow have no Source field at all", () => {
    const keywordRow = buildUploadKeywordRow({
      campaign: "x",
      adGroup: "y",
      text: "t",
      matchType: "exact",
      bid: 0.5,
      defaultBid: 0.5,
    });
    const targetingRow = buildUploadProductTargetingRow({
      campaign: "x",
      adGroup: "y",
      targetingExpression: "e",
      bid: 0.5,
    });
    expect("Source" in keywordRow).toBe(false);
    expect("Source" in targetingRow).toBe(false);
  });

  it("buildUploadKeywordRow and buildUploadProductTargetingRow accept an explicit operation for Update Campaign (spec §4)", () => {
    const keywordRow = buildUploadKeywordRow({ campaign: "x", adGroup: "y", text: "t", matchType: "exact", bid: 0.5, defaultBid: 0.5, operation: "Archive" });
    const targetingRow = buildUploadProductTargetingRow({ campaign: "x", adGroup: "y", targetingExpression: "e", bid: 0.5, operation: "Update" });
    expect(keywordRow.Operation).toBe("Archive");
    expect(targetingRow.Operation).toBe("Update");
  });
});
