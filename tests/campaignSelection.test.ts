import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_CAPS,
  DEFAULT_EXCLUSION,
  isCommonTypo,
  isMegaBestseller,
  isRaceToBottom,
  selectAlphaExactKeywords,
  selectBmmDiscoveryKeywords,
  selectBrandGuardKeywords,
  selectCatalogCrossSellTargets,
  selectRivalAsinTargets,
  toModifiedBroadSyntax,
  type CampaignBook,
  type CampaignKeyword,
  type KeywordWithRollups,
} from "../lib/campaignSelection";
import type { BookAnchors } from "../lib/keywordAnchors";
import type { CompetitorAsin } from "../lib/types";

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
    text: "cozy mystery series",
    sources: ["listing-metadata"],
    matchType: "phrase",
    status: "active",
    ...overrides,
  };
}

function competitor(overrides: Partial<CompetitorAsin> = {}): CompetitorAsin {
  return {
    id: "comp-1",
    book_id: "book-1",
    competitor_asin: "B0COMP0001",
    source: "manual",
    notes: null,
    status: "active",
    bid: null,
    rejection_reason: null,
    rejected_by_filter: null,
    title: null,
    author: null,
    price: 8,
    bsr: 50000,
    competitor_count: null,
    mean_rank: 10,
    created_at: "2026-01-01",
    updated_at: "2026-01-01",
    relationship: "rival",
    ...overrides,
  };
}

describe("CAMPAIGN_CAPS", () => {
  it("matches the spec's per-campaign caps", () => {
    expect(CAMPAIGN_CAPS).toEqual({ brandGuard: 15, alphaExact: 10, bmmDiscovery: 10, rivalAsin: 40 });
  });
});

describe("toModifiedBroadSyntax", () => {
  it("prefixes every word with '+' — Amazon has no real BMM match type, only Broad with '+' words", () => {
    expect(toModifiedBroadSyntax("cozy mystery cat")).toBe("+cozy +mystery +cat");
  });

  it("does not double-prefix a word that already has a '+'", () => {
    expect(toModifiedBroadSyntax("+cozy mystery")).toBe("+cozy +mystery");
  });
});

describe("isCommonTypo", () => {
  it("catches a one-character typo of the author's name", () => {
    expect(isCommonTypo("jane doi", "Jane Doe")).toBe(true);
  });

  it("does not flag an unrelated keyword", () => {
    expect(isCommonTypo("cozy mystery series", "Jane Doe")).toBe(false);
  });
});

describe("selectBrandGuardKeywords", () => {
  it("filters match_type before slicing, so filtering doesn't return fewer than the cap allows", () => {
    // Regression for the spec's named bug: v1 sliced brand terms before
    // filtering by match_type, which could under-fill the campaign even
    // when enough eligible candidates existed.
    const bank: CampaignKeyword[] = [
      ...Array.from({ length: 20 }, (_, i) => keyword({ id: `broad-${i}`, text: `jane doe book ${i}`, matchType: "broad", sources: ["comp-name"] })),
      ...Array.from({ length: 20 }, (_, i) => keyword({ id: `exact-${i}`, text: `jane doe mysteries ${i}`, matchType: "exact", sources: ["comp-name"] })),
    ];
    const result = selectBrandGuardKeywords(bank, BOOK);
    expect(result.length).toBe(CAMPAIGN_CAPS.brandGuard);
    expect(result.every((k) => k.matchType === "exact" || k.matchType === "phrase")).toBe(true);
  });

  it("includes author/title variants and excludes unrelated terms", () => {
    const bank: CampaignKeyword[] = [
      keyword({ id: "a", text: "jane doe mysteries", matchType: "exact" }),
      keyword({ id: "b", text: "the cozy mystery book", matchType: "phrase" }),
      keyword({ id: "c", text: "unrelated cooking recipes", matchType: "phrase" }),
    ];
    const result = selectBrandGuardKeywords(bank, BOOK);
    expect(result.map((k) => k.id).sort()).toEqual(["a", "b"]);
  });

  it("dedupes by normalized text", () => {
    const bank: CampaignKeyword[] = [
      keyword({ id: "a", text: "jane doe mysteries", matchType: "exact", sources: ["comp-name"] }),
      keyword({ id: "b", text: "Jane Doe Mysteries", matchType: "exact", sources: ["comp-name"] }),
    ];
    expect(selectBrandGuardKeywords(bank, BOOK)).toHaveLength(1);
  });
});

describe("selectAlphaExactKeywords", () => {
  it("ranks by lifetime orders first, then scoreForRank, then specificity", () => {
    const bank: KeywordWithRollups[] = [
      keyword({ id: "low-orders", text: "cozy mystery series", matchType: "exact", specificity: 3, lifetimeOrders: 1 }),
      keyword({ id: "high-orders", text: "jane doe cozy mystery", matchType: "exact", specificity: 2, lifetimeOrders: 8 }),
    ];
    const result = selectAlphaExactKeywords(bank, ANCHORS);
    expect(result[0].id).toBe("high-orders");
  });

  it("excludes non-exact and non-active rows", () => {
    const bank: KeywordWithRollups[] = [
      keyword({ id: "broad", matchType: "broad" }),
      keyword({ id: "paused", matchType: "exact", status: "paused" }),
      keyword({ id: "ok", matchType: "exact", status: "active" }),
    ];
    const result = selectAlphaExactKeywords(bank, ANCHORS);
    expect(result.map((k) => k.id)).toEqual(["ok"]);
  });

  it("caps at CAMPAIGN_CAPS.alphaExact", () => {
    const bank: KeywordWithRollups[] = Array.from({ length: 20 }, (_, i) =>
      keyword({ id: `kw-${i}`, text: `cozy mystery term ${i}`, matchType: "exact" })
    );
    expect(selectAlphaExactKeywords(bank, ANCHORS)).toHaveLength(CAMPAIGN_CAPS.alphaExact);
  });
});

describe("selectBmmDiscoveryKeywords", () => {
  it("excludes anything already in Alpha Exact or Brand Guard, by normalized text", () => {
    const alphaExact = [keyword({ id: "ae", text: "cozy mystery series", matchType: "exact" })];
    const brandGuard = [keyword({ id: "bg", text: "jane doe mysteries", matchType: "exact" })];
    const bank: CampaignKeyword[] = [
      keyword({ id: "root-1", text: "cozy mystery series", matchType: "broad", specificity: 1 }),
      keyword({ id: "root-2", text: "cat detective book", matchType: "broad", specificity: 2 }),
    ];
    const result = selectBmmDiscoveryKeywords(bank, alphaExact, brandGuard);
    expect(result.map((k) => k.rootKeywordId)).toEqual(["root-2"]);
  });

  it("only takes broad, active, low-specificity (<=2) root terms, and applies '+' BMM syntax", () => {
    const bank: CampaignKeyword[] = [
      keyword({ id: "ok", text: "cat mystery", matchType: "broad", specificity: 2, status: "active" }),
      keyword({ id: "too-specific", text: "very specific term", matchType: "broad", specificity: 4, status: "active" }),
      keyword({ id: "wrong-type", text: "exact term", matchType: "exact", specificity: 1, status: "active" }),
      keyword({ id: "paused", text: "paused term", matchType: "broad", specificity: 1, status: "paused" }),
    ];
    const result = selectBmmDiscoveryKeywords(bank, [], []);
    expect(result).toEqual([{ text: "+cat +mystery", rootKeywordId: "ok" }]);
  });
});

describe("isMegaBestseller / isRaceToBottom", () => {
  it("are independent rules, not a single AND (the spec's named bug fix)", () => {
    // A cheap-but-not-bestseller title: race-to-bottom only.
    expect(isMegaBestseller(competitor({ bsr: 50000, price: 1.99 }))).toBe(false);
    expect(isRaceToBottom(competitor({ bsr: 50000, price: 1.99 }))).toBe(true);
    // A top-10-bestseller priced at $14.99: mega-bestseller only, and must
    // still be excluded — this is the exact case v1's `bsr < 500 AND price <
    // 6` let straight through.
    expect(isMegaBestseller(competitor({ bsr: 10, price: 14.99 }))).toBe(true);
    expect(isRaceToBottom(competitor({ bsr: 10, price: 14.99 }))).toBe(false);
  });

  it("DEFAULT_EXCLUSION matches the spec's defaults", () => {
    expect(DEFAULT_EXCLUSION).toEqual({ maxBsr: 500, minPrice: 2.99 });
  });
});

describe("selectRivalAsinTargets", () => {
  it("excludes mega-bestsellers and race-to-the-bottom titles independently", () => {
    const bank: CompetitorAsin[] = [
      competitor({ id: "bestseller", bsr: 10, price: 14.99 }),
      competitor({ id: "cheap", bsr: 50000, price: 0.99 }),
      competitor({ id: "ok", bsr: 50000, price: 8 }),
    ];
    expect(selectRivalAsinTargets(bank).map((a) => a.id)).toEqual(["ok"]);
  });

  it("excludes non-rival and non-active rows, sorts by mean_rank ascending, caps at CAMPAIGN_CAPS.rivalAsin", () => {
    const bank: CompetitorAsin[] = [
      competitor({ id: "own-book", relationship: "own", mean_rank: 1 }),
      competitor({ id: "rejected", status: "rejected", mean_rank: 1 }),
      competitor({ id: "far", mean_rank: 20 }),
      competitor({ id: "near", mean_rank: 2 }),
    ];
    expect(selectRivalAsinTargets(bank).map((a) => a.id)).toEqual(["near", "far"]);
  });
});

describe("selectCatalogCrossSellTargets", () => {
  it("returns [] when the current book has no series_key", () => {
    expect(selectCatalogCrossSellTargets([BOOK], BOOK)).toEqual([]);
  });

  it("returns sibling books sharing series_key, excluding the current book and books with no ASIN", () => {
    const current: CampaignBook = { ...BOOK, id: "book-1", series_key: "jane-doe-mysteries" };
    const sibling: CampaignBook = { id: "book-2", author: "Jane Doe", title: "Book Two", series_key: "jane-doe-mysteries", asin: "B0BOOK0002" };
    const noAsin: CampaignBook = { id: "book-3", author: "Jane Doe", title: "Book Three", series_key: "jane-doe-mysteries", asin: null };
    const otherSeries: CampaignBook = { id: "book-4", author: "Jane Doe", title: "Other Series", series_key: "other-series", asin: "B0BOOK0004" };

    const result = selectCatalogCrossSellTargets([current, sibling, noAsin, otherSeries], current);
    expect(result).toEqual([{ asin: "B0BOOK0002", relationship: "own" }]);
  });
});
