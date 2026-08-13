import { describe, expect, it } from "vitest";
import { buildCampaignPlans, DEFAULT_DAILY_BUDGET_PER_CAMPAIGN } from "../lib/campaignBulksheetPlan";
import type { CampaignBook, KeywordWithRollups } from "../lib/campaignSelection";
import type { BookAnchors } from "../lib/keywordAnchors";
import type { CompetitorAsin } from "../lib/types";
import type { NegativeKeyword } from "../lib/negativeKeywords";

const BOOK: CampaignBook = { id: "book-1", author: "Jane Doe", title: "The Cozy Mystery", series_key: null, asin: "B0BOOKASIN" };

const ANCHORS: BookAnchors = {
  bookSpecific: ["cozy mystery", "jane doe"],
  genre: ["cozy mystery"],
  setting: [],
  comps: [],
  bookIntent: ["book", "novel"],
} as unknown as BookAnchors;

function keyword(overrides: Partial<KeywordWithRollups> = {}): KeywordWithRollups {
  return {
    id: overrides.id ?? "kw-1",
    text: "cozy mystery term",
    sources: ["listing-metadata"],
    matchType: "phrase",
    status: "active",
    bid: 0.5,
    ...overrides,
  };
}

function asin(overrides: Partial<CompetitorAsin> = {}): CompetitorAsin {
  return {
    id: "asin-1",
    book_id: "book-1",
    competitor_asin: "B0COMP0001",
    source: "manual",
    notes: null,
    status: "active",
    bid: 0.5,
    rejection_reason: null,
    rejected_by_filter: null,
    title: null,
    author: null,
    price: 8,
    bsr: 50000,
    competitor_count: null,
    mean_rank: 5,
    specificity: null,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    relationship: "rival",
    ...overrides,
  };
}

const STARTER_NEGATIVE: NegativeKeyword = { text: "textbook", matchType: "phrase", reason: "offTopicEntity" };

describe("buildCampaignPlans (campaigns spec §3/§4)", () => {
  it("skips campaigns with zero eligible targets rather than creating an empty one", async () => {
    const plans = await buildCampaignPlans({
      book: BOOK,
      bank: [],
      anchors: ANCHORS,
      asinBank: [],
      siblingBooks: [],
      negatives: [],
    });
    expect(plans).toEqual([]);
  });

  it("builds Brand Guard, Alpha Exact, BMM Discovery, Rival ASIN Offensive when each has eligible targets", async () => {
    const bank: KeywordWithRollups[] = [
      keyword({ id: "bg-1", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] }),
      keyword({ id: "ae-1", text: "cozy cat detective exact", matchType: "exact", lifetimeOrders: 4 }),
      keyword({ id: "bmm-1", text: "cat mystery", matchType: "broad", specificity: 1 }),
    ];
    const plans = await buildCampaignPlans({
      book: BOOK,
      bank,
      anchors: ANCHORS,
      asinBank: [asin()],
      siblingBooks: [],
      negatives: [],
    });

    const types = plans.map((p) => p.campaignType);
    expect(types).toEqual(
      expect.arrayContaining(["brand_guard", "alpha_exact", "bmm_discovery", "rival_asin_offensive"])
    );
    expect(types).not.toContain("catalog_cross_sell");
    expect(types).not.toContain("auto_discovery");
  });

  it("Alpha Exact keywords become a campaign-level negative-exact in BMM Discovery", async () => {
    const bank: KeywordWithRollups[] = [
      keyword({ id: "ae-1", text: "alpha exact term", matchType: "exact", lifetimeOrders: 4 }),
      keyword({ id: "bmm-1", text: "cat mystery", matchType: "broad", specificity: 1 }),
    ];
    const plans = await buildCampaignPlans({ book: BOOK, bank, anchors: ANCHORS, asinBank: [], siblingBooks: [], negatives: [] });
    const bmm = plans.find((p) => p.campaignType === "bmm_discovery")!;
    expect(bmm.negatives).toContainEqual(
      expect.objectContaining({ text: "alpha exact term", matchType: "exact", scope: "campaign" })
    );
  });

  // Auto Discovery needs the safeguard at least as badly as BMM: its four
  // targeting groups match semantically with no keyword list, so a promoted
  // term stays reachable there and the two campaigns bid against each other
  // on the one query that has proven it converts.
  it("Alpha Exact keywords become a campaign-level negative-exact in Auto Discovery too", async () => {
    const bank: KeywordWithRollups[] = [
      keyword({ id: "ae-1", text: "alpha exact term", matchType: "exact", lifetimeOrders: 4 }),
      keyword({ id: "bmm-1", text: "cat mystery", matchType: "broad", specificity: 1 }),
    ];
    const plans = await buildCampaignPlans({
      book: BOOK,
      bank,
      anchors: ANCHORS,
      asinBank: [],
      siblingBooks: [],
      negatives: [],
      includeAutoDiscovery: true,
    });
    const auto = plans.find((p) => p.campaignType === "auto_discovery")!;
    expect(auto.negatives).toContainEqual(
      expect.objectContaining({ text: "alpha exact term", matchType: "exact", scope: "campaign" })
    );
  });

  it("drops a promoted term too long to be a valid negative exact rather than emitting an invalid row", async () => {
    const tooLong = "one two three four five six seven eight nine ten eleven";
    const bank: KeywordWithRollups[] = [
      keyword({ id: "ae-1", text: tooLong, matchType: "exact", lifetimeOrders: 4 }),
      keyword({ id: "bmm-1", text: "cat mystery", matchType: "broad", specificity: 1 }),
    ];
    const plans = await buildCampaignPlans({
      book: BOOK,
      bank,
      anchors: ANCHORS,
      asinBank: [],
      siblingBooks: [],
      negatives: [],
      includeAutoDiscovery: true,
    });
    for (const type of ["bmm_discovery", "auto_discovery"] as const) {
      const plan = plans.find((p) => p.campaignType === type);
      expect(plan?.negatives.some((n) => n.text === tooLong)).toBe(false);
    }
  });

  it("BMM Discovery keywords export with '+' BMM syntax as the target text", async () => {
    const bank: KeywordWithRollups[] = [keyword({ id: "bmm-1", text: "cat mystery", matchType: "broad", specificity: 1 })];
    const plans = await buildCampaignPlans({ book: BOOK, bank, anchors: ANCHORS, asinBank: [], siblingBooks: [], negatives: [] });
    const bmm = plans.find((p) => p.campaignType === "bmm_discovery")!;
    expect(bmm.targets[0]).toMatchObject({ text: "+cat +mystery", matchType: "broad", keywordId: "bmm-1" });
  });

  it("starter/library negatives attach to every campaign at ad_group scope", async () => {
    const bank: KeywordWithRollups[] = [keyword({ id: "bg-1", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] })];
    const plans = await buildCampaignPlans({
      book: BOOK,
      bank,
      anchors: ANCHORS,
      asinBank: [],
      siblingBooks: [],
      negatives: [STARTER_NEGATIVE],
    });
    const brandGuard = plans.find((p) => p.campaignType === "brand_guard")!;
    expect(brandGuard.negatives).toContainEqual(expect.objectContaining({ text: "textbook", scope: "ad_group" }));
  });

  it("Catalog Cross-Sell only appears when the book has a series_key and eligible siblings", async () => {
    const seriesBook: CampaignBook = { ...BOOK, series_key: "jane-doe-mysteries" };
    const sibling: CampaignBook = { id: "book-2", author: "Jane Doe", title: "Book Two", series_key: "jane-doe-mysteries", asin: "B0SIBLING1" };

    const withoutSeries = await buildCampaignPlans({ book: BOOK, bank: [], anchors: ANCHORS, asinBank: [], siblingBooks: [sibling], negatives: [] });
    expect(withoutSeries.some((p) => p.campaignType === "catalog_cross_sell")).toBe(false);

    const withSeries = await buildCampaignPlans({ book: seriesBook, bank: [], anchors: ANCHORS, asinBank: [], siblingBooks: [sibling], negatives: [] });
    const crossSell = withSeries.find((p) => p.campaignType === "catalog_cross_sell");
    expect(crossSell).toBeDefined();
    expect(crossSell?.targets[0]).toMatchObject({ targetingExpression: 'asin="B0SIBLING1"' });
  });

  it("Rival ASIN Offensive excludes mega-bestsellers and race-to-the-bottom titles", async () => {
    const asinBank: CompetitorAsin[] = [
      asin({ id: "bestseller", bsr: 10, price: 14.99 }),
      asin({ id: "cheap", bsr: 50000, price: 0.99 }),
      asin({ id: "ok", bsr: 50000, price: 8 }),
    ];
    const plans = await buildCampaignPlans({ book: BOOK, bank: [], anchors: ANCHORS, asinBank, siblingBooks: [], negatives: [] });
    const rival = plans.find((p) => p.campaignType === "rival_asin_offensive")!;
    expect(rival.targets.map((t) => t.competitorAsinId)).toEqual(["ok"]);
  });

  it("includes Auto Discovery only when includeAutoDiscovery is true and there's something to discover from", async () => {
    const bank: KeywordWithRollups[] = [keyword({ id: "bg-1", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] })];
    const withoutAuto = await buildCampaignPlans({ book: BOOK, bank, anchors: ANCHORS, asinBank: [], siblingBooks: [], negatives: [] });
    expect(withoutAuto.some((p) => p.campaignType === "auto_discovery")).toBe(false);

    const withAuto = await buildCampaignPlans({
      book: BOOK,
      bank,
      anchors: ANCHORS,
      asinBank: [],
      siblingBooks: [],
      negatives: [],
      includeAutoDiscovery: true,
    });
    expect(withAuto.some((p) => p.campaignType === "auto_discovery")).toBe(true);
  });

  it("gives Auto Discovery one ad group per targeting group, and every other campaign one ad group named after itself", async () => {
    const bank: KeywordWithRollups[] = [keyword({ id: "bg-1", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] })];
    const plans = await buildCampaignPlans({
      book: BOOK,
      bank,
      anchors: ANCHORS,
      asinBank: [],
      siblingBooks: [],
      negatives: [],
      includeAutoDiscovery: true,
    });
    const brandGuard = plans.find((p) => p.campaignType === "brand_guard")!;
    expect(brandGuard.targets.every((t) => t.adGroup === "Brand Guard")).toBe(true);

    const auto = plans.find((p) => p.campaignType === "auto_discovery")!;
    const adGroups = new Set(auto.targets.map((t) => t.adGroup));
    expect(adGroups.size).toBe(4);
  });

  it("defaults every campaign's daily budget to $25 and names campaigns from the book title", async () => {
    const bank: KeywordWithRollups[] = [keyword({ id: "bg-1", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] })];
    const plans = await buildCampaignPlans({ book: BOOK, bank, anchors: ANCHORS, asinBank: [], siblingBooks: [], negatives: [] });
    expect(plans[0].dailyBudget).toBe(DEFAULT_DAILY_BUDGET_PER_CAMPAIGN);
    expect(plans[0].name).toContain("The Cozy Mystery");
  });

  it("respects a custom per-campaign daily budget", async () => {
    const bank: KeywordWithRollups[] = [keyword({ id: "bg-1", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] })];
    const plans = await buildCampaignPlans({ book: BOOK, bank, anchors: ANCHORS, asinBank: [], siblingBooks: [], negatives: [], dailyBudgetPerCampaign: 10 });
    expect(plans[0].dailyBudget).toBe(10);
  });
});
