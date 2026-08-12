import { describe, expect, it } from "vitest";
import { buildCampaignReviewRows, buildCampaignUploadRows } from "../lib/campaignBulksheetExport";
import type { CampaignPlan } from "../lib/campaignBulksheetPlan";

const SKU = "B0EXAMPLE1";

const SIMPLE_PLAN: CampaignPlan = {
  campaignType: "brand_guard",
  name: "My Book – Brand Guard",
  dailyBudget: 25,
  targets: [
    { keywordId: "kw-1", text: "jane doe mysteries", matchType: "exact", bid: 0.6, adGroup: "Brand Guard" },
  ],
  negatives: [{ text: "textbook", matchType: "phrase", reason: "offTopicEntity", scope: "ad_group" }],
};

const CAMPAIGN_NEGATIVE_PLAN: CampaignPlan = {
  campaignType: "bmm_discovery",
  name: "My Book – BMM Discovery",
  dailyBudget: 25,
  targets: [{ keywordId: "kw-2", text: "+cozy +mystery", matchType: "broad", bid: 0.4, adGroup: "BMM Discovery" }],
  negatives: [{ text: "alpha term", matchType: "exact", reason: "Alpha Exact promotion safeguard", scope: "campaign" }],
};

const PRODUCT_TARGETING_PLAN: CampaignPlan = {
  campaignType: "rival_asin_offensive",
  name: "My Book – Rival ASIN Offensive",
  dailyBudget: 25,
  targets: [
    {
      competitorAsinId: "asin-1",
      text: 'asin="B0COMP0001"',
      targetingExpression: 'asin="B0COMP0001"',
      bid: 0.5,
      adGroup: "Rival ASIN Offensive",
    },
  ],
  negatives: [],
};

const MULTI_AD_GROUP_PLAN: CampaignPlan = {
  campaignType: "auto_discovery",
  name: "My Book – Auto Discovery",
  dailyBudget: 2.5,
  targets: [
    { text: 'targetingExpression="close-match"', targetingExpression: 'targetingExpression="close-match"', bid: 0.5, adGroup: "Auto: close match" },
    { text: 'targetingExpression="substitutes"', targetingExpression: 'targetingExpression="substitutes"', bid: 0.4, adGroup: "Auto: substitutes" },
  ],
  negatives: [{ text: "textbook", matchType: "phrase", reason: "offTopicEntity", scope: "ad_group" }],
};

describe("buildCampaignReviewRows", () => {
  it("emits Campaign, Ad Group, Keyword, and Negative Keyword rows for a simple plan", () => {
    const rows = buildCampaignReviewRows([SIMPLE_PLAN]);
    expect(rows.map((r) => r.Entity)).toEqual(["Campaign", "Ad Group", "Keyword", "Negative Keyword"]);
    expect(rows[0]).toMatchObject({ "Campaign Name": "My Book – Brand Guard", "Daily Budget": "25.00" });
    expect(rows[2]).toMatchObject({ "Keyword or Product Targeting": "jane doe mysteries", "Match Type": "exact", Bid: "0.60" });
  });

  it("routes a campaign-scoped negative to Campaign Negative Keyword with no Ad Group Name", () => {
    const rows = buildCampaignReviewRows([CAMPAIGN_NEGATIVE_PLAN]);
    const campaignNegative = rows.find((r) => r.Entity === "Campaign Negative Keyword");
    expect(campaignNegative).toBeDefined();
    expect(campaignNegative?.["Ad Group Name"]).toBe("");
  });

  it("emits Product Targeting rows for ASIN-based targets", () => {
    const rows = buildCampaignReviewRows([PRODUCT_TARGETING_PLAN]);
    expect(rows.some((r) => r.Entity === "Product Targeting" && r["Keyword or Product Targeting"] === 'asin="B0COMP0001"')).toBe(true);
  });

  it("emits one Ad Group row per distinct ad group, and attaches ad_group-scoped negatives only to the first", () => {
    const rows = buildCampaignReviewRows([MULTI_AD_GROUP_PLAN]);
    const adGroupRows = rows.filter((r) => r.Entity === "Ad Group");
    expect(adGroupRows.map((r) => r["Ad Group Name"])).toEqual(["Auto: close match", "Auto: substitutes"]);

    const negativeRows = rows.filter((r) => r.Entity === "Negative Keyword");
    expect(negativeRows).toHaveLength(1);
    expect(negativeRows[0]["Ad Group Name"]).toBe("Auto: close match");
  });

  it("every row's Campaign/Ad Group Name resolves to a Campaign/Ad Group row in the same file (no orphans)", () => {
    const rows = buildCampaignReviewRows([SIMPLE_PLAN, CAMPAIGN_NEGATIVE_PLAN, PRODUCT_TARGETING_PLAN, MULTI_AD_GROUP_PLAN]);
    const campaignNames = new Set(rows.filter((r) => r.Entity === "Campaign").map((r) => r["Campaign Name"]));
    const adGroupKeys = new Set(rows.filter((r) => r.Entity === "Ad Group").map((r) => `${r["Campaign Name"]}::${r["Ad Group Name"]}`));

    for (const row of rows) {
      if (row.Entity === "Campaign") continue;
      expect(campaignNames.has(row["Campaign Name"])).toBe(true);
      if (row.Entity === "Campaign Negative Keyword") continue; // campaign-scoped, no ad group by definition
      expect(adGroupKeys.has(`${row["Campaign Name"]}::${row["Ad Group Name"]}`)).toBe(true);
    }
  });
});

describe("buildCampaignUploadRows", () => {
  it("adds a Product Ad row per ad group, using the campaign's SKU", () => {
    const rows = buildCampaignUploadRows([SIMPLE_PLAN], SKU);
    const productAd = rows.find((r) => r.Entity === "Product Ad");
    expect(productAd).toMatchObject({ SKU, "Campaign Name": "My Book – Brand Guard", "Ad Group Name": "Brand Guard" });
  });

  it("every row uses Operation 'Create' and no row has a Source key", () => {
    const rows = buildCampaignUploadRows([SIMPLE_PLAN, CAMPAIGN_NEGATIVE_PLAN, PRODUCT_TARGETING_PLAN], SKU);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.Operation).toBe("Create");
      expect("Source" in row).toBe(false);
    }
  });

  it("campaign-scoped negatives use Campaign Negative Keyword with the camelCase match code", () => {
    const rows = buildCampaignUploadRows([CAMPAIGN_NEGATIVE_PLAN], SKU);
    const campaignNegative = rows.find((r) => r.Entity === "Campaign Negative Keyword");
    expect(campaignNegative).toMatchObject({ "Match Type": "negativeExact", "Ad Group Name": "" });
  });

  it("gives Auto Discovery's multiple ad groups their own Product Ad row each", () => {
    const rows = buildCampaignUploadRows([MULTI_AD_GROUP_PLAN], SKU);
    const productAdRows = rows.filter((r) => r.Entity === "Product Ad");
    expect(productAdRows.map((r) => r["Ad Group Name"])).toEqual(["Auto: close match", "Auto: substitutes"]);
  });
});
