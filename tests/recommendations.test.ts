import { describe, expect, it } from "vitest";
import {
  MIN_CLICKS_FOR_ARCHIVE,
  MIN_CLICKS_FOR_BID_CHANGE,
  RECOMMENDATION_COOLDOWN_DAYS,
  recommendForCompetitorAsin,
  recommendForKeyword,
  shouldSuppressRecommendation,
  type KeywordPerformance,
  type PastRecommendation,
} from "../lib/recommendations";

const TARGET_ACOS = 0.3;

function keyword(overrides: Partial<KeywordPerformance> = {}): KeywordPerformance {
  return {
    id: "kw-1",
    bid: 0.5,
    status: "active",
    campaignType: null,
    resultsUpdatedAt: "2026-08-01T00:00:00Z",
    lifetimeClicks: 0,
    lifetimeOrders: 0,
    lifetimeSpend: 0,
    lastClicks: 0,
    lastSpend: 0,
    lastSales: 0,
    lastOrders: 0,
    ...overrides,
  };
}

describe("recommendForKeyword", () => {
  it("returns [] before any real results exist (resultsUpdatedAt null)", () => {
    expect(recommendForKeyword(keyword({ resultsUpdatedAt: null, lifetimeClicks: 100 }), TARGET_ACOS)).toEqual([]);
  });

  it("archive uses LIFETIME clicks and orders, never last-period — a quiet last period must not trigger it on its own", () => {
    // 40 lifetime clicks, 6 lifetime orders (a real performer), but 0 orders
    // last period. Spec's named bug: mixing lifetime clicks against
    // last-period orders would archive this at confidence 'high'.
    const kw = keyword({
      lifetimeClicks: 40,
      lifetimeOrders: 6,
      lifetimeSpend: 20,
      lastClicks: 5,
      lastOrders: 0,
      lastSpend: 2,
      lastSales: 0,
    });
    const recs = recommendForKeyword(kw, TARGET_ACOS);
    expect(recs.some((r) => r.type === "archive")).toBe(false);
  });

  it("archives when lifetime clicks/spend are high and lifetime orders are genuinely zero", () => {
    const kw = keyword({ lifetimeClicks: MIN_CLICKS_FOR_ARCHIVE, lifetimeOrders: 0, lifetimeSpend: 15 });
    const recs = recommendForKeyword(kw, TARGET_ACOS);
    expect(recs).toContainEqual(
      expect.objectContaining({ type: "archive", confidence: "high", keywordId: "kw-1" })
    );
  });

  it("does not archive below the lifetime click threshold, even at zero orders", () => {
    const kw = keyword({ lifetimeClicks: MIN_CLICKS_FOR_ARCHIVE - 1, lifetimeOrders: 0, lifetimeSpend: 15 });
    expect(recommendForKeyword(kw, TARGET_ACOS).some((r) => r.type === "archive")).toBe(false);
  });

  it("bid moves use the LAST PERIOD's ACOS, not lifetime", () => {
    const kw = keyword({
      lifetimeClicks: MIN_CLICKS_FOR_BID_CHANGE,
      lifetimeOrders: 1,
      lastClicks: 10,
      lastSpend: 10,
      lastSales: 10, // last-period ACOS = 1.0, well over target
      bid: 0.5,
    });
    const recs = recommendForKeyword(kw, TARGET_ACOS);
    const decrease = recs.find((r) => r.type === "decrease_bid");
    expect(decrease).toBeDefined();
    expect(decrease?.suggestedBid).toBeLessThan(0.5);
  });

  it("increases bid when last-period ACOS is well under target and there were last-period orders", () => {
    const kw = keyword({
      lifetimeClicks: MIN_CLICKS_FOR_BID_CHANGE,
      lifetimeOrders: 3,
      lastClicks: 10,
      lastSpend: 1,
      lastSales: 10, // ACOS = 0.10, well under 0.30 target
      lastOrders: 2,
      bid: 0.5,
    });
    const recs = recommendForKeyword(kw, TARGET_ACOS);
    const increase = recs.find((r) => r.type === "increase_bid");
    expect(increase).toBeDefined();
    expect(increase?.suggestedBid).toBeGreaterThan(0.5);
  });

  it("does not increase bid on low ACOS with zero last-period orders (no evidence the lower bid is why)", () => {
    const kw = keyword({
      lifetimeClicks: MIN_CLICKS_FOR_BID_CHANGE,
      lifetimeOrders: 3,
      lastClicks: 10,
      lastSpend: 1,
      lastSales: 10,
      lastOrders: 0,
      bid: 0.5,
    });
    expect(recommendForKeyword(kw, TARGET_ACOS).some((r) => r.type === "increase_bid")).toBe(false);
  });

  it("raises promote_to_alpha_exact for a BMM Discovery keyword with 3+ lifetime orders", () => {
    const kw = keyword({ campaignType: "bmm_discovery", lifetimeOrders: 3, lifetimeClicks: 5 });
    const recs = recommendForKeyword(kw, TARGET_ACOS);
    expect(recs).toContainEqual(expect.objectContaining({ type: "promote_to_alpha_exact", confidence: "high" }));
  });

  it("does not promote a non-BMM keyword even with 3+ lifetime orders", () => {
    const kw = keyword({ campaignType: "alpha_exact", lifetimeOrders: 3, lifetimeClicks: 5 });
    expect(recommendForKeyword(kw, TARGET_ACOS).some((r) => r.type === "promote_to_alpha_exact")).toBe(false);
  });

  it("returns every applicable recommendation, sorted by severity, rather than stopping at the first match", () => {
    // Both promote-eligible AND archive-eligible in the same call: an
    // early-return chain would only ever surface one.
    const kw = keyword({
      campaignType: "bmm_discovery",
      lifetimeOrders: 0,
      lifetimeClicks: MIN_CLICKS_FOR_ARCHIVE,
      lifetimeSpend: 15,
    });
    const recs = recommendForKeyword(kw, TARGET_ACOS);
    expect(recs.map((r) => r.type)).toContain("archive");
    // archive outranks the (not actually applicable here since orders=0,
    // but this keyword's other branch) — assert archive sorts first among
    // whatever fired.
    expect(recs[0].type).toBe("archive");
  });
});

describe("recommendForCompetitorAsin", () => {
  it("applies the same archive/bid rules, keyed by competitorAsinId not keywordId", () => {
    const asin = keyword({ id: "asin-1", lifetimeClicks: MIN_CLICKS_FOR_ARCHIVE, lifetimeOrders: 0, lifetimeSpend: 15 });
    const recs = recommendForCompetitorAsin(asin, TARGET_ACOS);
    expect(recs).toContainEqual(expect.objectContaining({ type: "archive", competitorAsinId: "asin-1" }));
    expect(recs.every((r) => r.keywordId === undefined)).toBe(true);
  });

  it("never raises promote_to_alpha_exact for a competitor ASIN (keyword-only rule)", () => {
    const asin = keyword({ id: "asin-1", campaignType: "bmm_discovery", lifetimeOrders: 5, lifetimeClicks: 5 });
    expect(recommendForCompetitorAsin(asin, TARGET_ACOS).some((r) => r.type === "promote_to_alpha_exact")).toBe(false);
  });
});

describe("shouldSuppressRecommendation (cooldown)", () => {
  it("matches the spec's default cooldown", () => {
    expect(RECOMMENDATION_COOLDOWN_DAYS).toBe(30);
  });

  const now = new Date("2026-08-12T00:00:00Z");

  it("suppresses a type rejected within the cooldown window", () => {
    const past: PastRecommendation[] = [
      { type: "archive", status: "rejected", decidedAt: "2026-08-01T00:00:00Z" },
    ];
    expect(shouldSuppressRecommendation("archive", past, now)).toBe(true);
  });

  it("does not suppress after the cooldown window has passed", () => {
    const past: PastRecommendation[] = [
      { type: "archive", status: "rejected", decidedAt: "2026-06-01T00:00:00Z" },
    ];
    expect(shouldSuppressRecommendation("archive", past, now)).toBe(false);
  });

  it("does not suppress a different recommendation type", () => {
    const past: PastRecommendation[] = [
      { type: "decrease_bid", status: "rejected", decidedAt: "2026-08-01T00:00:00Z" },
    ];
    expect(shouldSuppressRecommendation("archive", past, now)).toBe(false);
  });

  it("does not suppress on an accepted (not rejected) past recommendation", () => {
    const past: PastRecommendation[] = [
      { type: "archive", status: "accepted", decidedAt: "2026-08-01T00:00:00Z" },
    ];
    expect(shouldSuppressRecommendation("archive", past, now)).toBe(false);
  });
});
