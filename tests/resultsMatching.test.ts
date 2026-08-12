import { describe, expect, it } from "vitest";
import { aggregateByTarget, matchResultRows, type MatchContext } from "../lib/resultsMatching";
import type { SearchTermReportRow } from "../lib/searchTermImport";

function row(overrides: Partial<SearchTermReportRow> = {}): SearchTermReportRow {
  return {
    text: "cozy mystery near me",
    clicks: 1,
    orders: 0,
    cost: 1,
    acos: 0,
    campaignName: "My Book – Descriptive – Broad/Phrase",
    adGroupName: "Descriptive",
    targeting: "cozy mystery series",
    matchType: "phrase",
    impressions: 10,
    sales: 0,
    ...overrides,
  };
}

describe("aggregateByTarget", () => {
  it("rolls multiple search terms up to one row per (campaign, ad group, targeting, match type)", () => {
    const rows = [
      row({ text: "cozy mystery near me", clicks: 3, orders: 1, cost: 2, sales: 8, impressions: 10 }),
      row({ text: "cozy mystery books free", clicks: 2, orders: 0, cost: 1, sales: 0, impressions: 5 }),
      row({ targeting: "a different keyword", text: "unrelated search" }),
    ];
    const aggregated = aggregateByTarget(rows);
    expect(aggregated).toHaveLength(2);

    const target = aggregated.find((r) => r.targeting === "cozy mystery series")!;
    expect(target).toMatchObject({
      campaignName: "My Book – Descriptive – Broad/Phrase",
      adGroupName: "Descriptive",
      matchType: "phrase",
      clicks: 5,
      orders: 1,
      spend: 3,
      sales: 8,
      impressions: 15,
    });
  });

  it("treats rows with no campaign/ad-group/targeting info as their own bucket rather than merging incorrectly", () => {
    const rows = [row({ campaignName: undefined, adGroupName: undefined, targeting: undefined, matchType: undefined })];
    const aggregated = aggregateByTarget(rows);
    expect(aggregated).toEqual([
      {
        campaignName: null,
        adGroupName: null,
        targeting: null,
        matchType: null,
        impressions: 10,
        clicks: 1,
        spend: 1,
        sales: 0,
        orders: 0,
      },
    ]);
  });
});

describe("matchResultRows", () => {
  const context: MatchContext = {
    keywordsByTextAndMatchType: new Map([["cozy mystery series::phrase", "kw-1"]]),
    competitorAsinsByAsin: new Map([["B0EXAMPLE1", "asin-1"]]),
    campaignsByName: new Map([["My Book – Descriptive – Broad/Phrase", "camp-1"]]),
  };

  it("matches a keyword row by normalized text + match type, and the campaign by exact name", () => {
    const aggregated = aggregateByTarget([row()]);
    const { matched, unmatchedCount } = matchResultRows(aggregated, context);
    expect(matched).toHaveLength(1);
    expect(matched[0]).toMatchObject({ campaignId: "camp-1", keywordId: "kw-1", competitorAsinId: null });
    expect(unmatchedCount).toBe(0);
  });

  it("strips '+' BMM prefixes before matching against the stored (unprefixed) keyword text", () => {
    const aggregated = aggregateByTarget([row({ targeting: "+cozy +mystery +series" })]);
    const { matched } = matchResultRows(aggregated, context);
    expect(matched[0].keywordId).toBe("kw-1");
  });

  it("matches a product-targeting row to its competitor ASIN, not a keyword", () => {
    const aggregated = aggregateByTarget([
      row({ targeting: 'asin="B0EXAMPLE1"', matchType: undefined, adGroupName: "ASIN & brand targets" }),
    ]);
    const { matched, unmatchedCount } = matchResultRows(aggregated, context);
    expect(matched[0]).toMatchObject({ keywordId: null, competitorAsinId: "asin-1" });
    expect(unmatchedCount).toBe(0);
  });

  it("counts a row as unmatched when neither a keyword nor an ASIN resolves, even if the campaign does", () => {
    const aggregated = aggregateByTarget([row({ targeting: "a renamed or unknown keyword" })]);
    const { matched, unmatchedCount } = matchResultRows(aggregated, context);
    expect(matched[0]).toMatchObject({ campaignId: "camp-1", keywordId: null, competitorAsinId: null });
    expect(unmatchedCount).toBe(1);
  });

  it("leaves campaignId null when the campaign name isn't in the map (renamed/deleted campaign)", () => {
    const aggregated = aggregateByTarget([row({ campaignName: "Some Other Campaign" })]);
    const { matched } = matchResultRows(aggregated, context);
    expect(matched[0].campaignId).toBeNull();
  });
});
