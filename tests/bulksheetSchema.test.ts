import { describe, expect, it } from "vitest";
import {
  BULKSHEET_COLUMNS,
  buildAdGroupRow,
  buildCampaignRow,
  buildKeywordRow,
  buildNegativeKeywordRow,
  buildProductTargetingRow,
  PRODUCT,
} from "../lib/bulksheetSchema";

describe("bulksheetSchema", () => {
  it("BULKSHEET_COLUMNS matches today's committed column order", () => {
    // PR 2 (campaigns spec §8) promotes the existing column contract with no
    // behaviour change. This locks that order down so a later PR can't
    // reshuffle it without a deliberate, reviewed edit.
    expect(BULKSHEET_COLUMNS).toEqual([
      "Product",
      "Entity",
      "Operation",
      "Campaign Name",
      "Ad Group Name",
      "Keyword or Product Targeting",
      "Match Type",
      "Bid",
      "Daily Budget",
      "Campaign Targeting Type",
      "State",
      "Source",
    ]);
  });

  it("every row builder only ever uses keys from BULKSHEET_COLUMNS", () => {
    const rows = [
      buildCampaignRow({ name: "Book – Descriptive", dailyBudget: 25, targetingType: "manual" }),
      buildAdGroupRow({ campaign: "Book – Descriptive", adGroup: "Descriptive", bid: 0.5 }),
      buildKeywordRow({
        campaign: "Book – Descriptive",
        adGroup: "Descriptive",
        text: "cozy mystery",
        matchType: "phrase",
        bid: 0.6,
        defaultBid: 0.5,
        status: "active",
        source: "listing-metadata",
      }),
      buildNegativeKeywordRow({
        campaign: "Book – Descriptive",
        adGroup: "Descriptive",
        text: "textbook",
        matchType: "phrase",
        reason: "offTopicEntity",
      }),
      buildProductTargetingRow({
        campaign: "Book – Product Targeting",
        adGroup: "ASIN & brand targets",
        targetingExpression: 'asin="B0EXAMPLE1"',
        bid: 0.5,
        source: "Example Title",
      }),
    ];

    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([...BULKSHEET_COLUMNS].sort());
    }
  });

  it("buildCampaignRow", () => {
    const row = buildCampaignRow({
      name: "My Book – Descriptive – Broad/Phrase",
      dailyBudget: 25,
      targetingType: "manual",
    });
    expect(row).toMatchObject({
      Product: PRODUCT,
      Entity: "Campaign",
      Operation: "create",
      "Campaign Name": "My Book – Descriptive – Broad/Phrase",
      "Daily Budget": "25.00",
      "Campaign Targeting Type": "manual",
      State: "enabled",
    });
  });

  it("buildAdGroupRow", () => {
    const row = buildAdGroupRow({
      campaign: "My Book – Descriptive",
      adGroup: "Descriptive",
      bid: 0.5,
    });
    expect(row).toMatchObject({
      Product: PRODUCT,
      Entity: "Ad Group",
      Operation: "create",
      "Campaign Name": "My Book – Descriptive",
      "Ad Group Name": "Descriptive",
      Bid: "0.50",
      State: "enabled",
    });
  });

  it("buildKeywordRow falls back to defaultBid when the entry has no bid", () => {
    const row = buildKeywordRow({
      campaign: "My Book – Descriptive",
      adGroup: "Descriptive",
      text: "cozy mystery",
      matchType: "phrase",
      bid: null,
      defaultBid: 0.5,
      status: null,
      source: null,
    });
    expect(row).toMatchObject({
      Entity: "Keyword",
      "Keyword or Product Targeting": "cozy mystery",
      "Match Type": "phrase",
      Bid: "0.50",
      State: "enabled",
      Source: "",
    });
  });

  it("buildKeywordRow uses the entry's own bid and maps paused status", () => {
    const row = buildKeywordRow({
      campaign: "My Book – Descriptive",
      adGroup: "Descriptive",
      text: "cat mystery series",
      matchType: "exact",
      bid: 0.75,
      defaultBid: 0.5,
      status: "paused",
      source: "search-term-report",
    });
    expect(row).toMatchObject({
      Bid: "0.75",
      State: "paused",
      Source: "search-term-report",
    });
  });

  it("buildKeywordRow defaults Operation to lowercase 'create' but accepts an explicit operation (Update Campaign, spec §4)", () => {
    const defaulted = buildKeywordRow({ campaign: "x", adGroup: "y", text: "t", matchType: "exact", bid: 0.5, defaultBid: 0.5 });
    expect(defaulted.Operation).toBe("create");

    const updated = buildKeywordRow({ campaign: "x", adGroup: "y", text: "t", matchType: "exact", bid: 0.6, defaultBid: 0.5, operation: "Update" });
    expect(updated.Operation).toBe("Update");
  });

  it("buildNegativeKeywordRow prefixes the match type with 'negative'", () => {
    const row = buildNegativeKeywordRow({
      campaign: "My Book – Descriptive",
      adGroup: "Descriptive",
      text: "textbook",
      matchType: "phrase",
      reason: "offTopicEntity",
    });
    expect(row).toMatchObject({
      Entity: "Negative Keyword",
      "Keyword or Product Targeting": "textbook",
      "Match Type": "negative phrase",
      State: "enabled",
      Source: "offTopicEntity",
    });
  });

  it("buildProductTargetingRow", () => {
    const row = buildProductTargetingRow({
      campaign: "My Book – Product Targeting",
      adGroup: "ASIN & brand targets",
      targetingExpression: 'asin="B0EXAMPLE1"',
      bid: 0.5,
      source: "Comparable Title",
    });
    expect(row).toMatchObject({
      Entity: "Product Targeting",
      "Keyword or Product Targeting": 'asin="B0EXAMPLE1"',
      Bid: "0.50",
      State: "enabled",
      Source: "Comparable Title",
    });
  });
});
