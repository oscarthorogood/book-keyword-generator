/**
 * Bid decision system (docs/COMPETITOR-BIDDING.md, competitor-ASIN
 * enhancements task 2) — unit tests for the pure computeCompetitorBid()
 * scoring function and its clampBid() range guard.
 */

import { describe, expect, it } from "vitest";
import { clampBid, DEFAULT_COMPETITOR_BID_RANGE } from "../lib/amazonAds";
import { computeCompetitorBid } from "../lib/competitorBidding";

describe("clampBid", () => {
  it("passes bids already inside the range through unchanged", () => {
    expect(clampBid(0.5)).toBe(0.5);
  });

  it("clamps below the range floor", () => {
    expect(clampBid(0.01)).toBe(DEFAULT_COMPETITOR_BID_RANGE.min);
  });

  it("clamps above the range ceiling", () => {
    expect(clampBid(10)).toBe(DEFAULT_COMPETITOR_BID_RANGE.max);
  });

  it("respects a custom range", () => {
    expect(clampBid(5, { min: 1, max: 3 })).toBe(3);
  });
});

describe("computeCompetitorBid", () => {
  it("returns the weakest multiplier (0.85x base) when every signal is missing", () => {
    expect(computeCompetitorBid({})).toBe(0.43);
  });

  it("scales up with a strong BSR", () => {
    const weak = computeCompetitorBid({ bsr: 500_000 });
    const strong = computeCompetitorBid({ bsr: 1_000 });
    expect(strong).toBeGreaterThan(weak);
  });

  it("scales up with a higher price", () => {
    const cheap = computeCompetitorBid({ price: 2.99 });
    const pricey = computeCompetitorBid({ price: 14.99 });
    expect(pricey).toBeGreaterThan(cheap);
  });

  it("scales up with a higher competitor count (more source agreement)", () => {
    const single = computeCompetitorBid({ competitorCount: 1 });
    const multi = computeCompetitorBid({ competitorCount: 5 });
    expect(multi).toBeGreaterThan(single);
  });

  it("scales up with a lower (more prominent) mean rank", () => {
    const buried = computeCompetitorBid({ meanRank: 50 });
    const prominent = computeCompetitorBid({ meanRank: 1 });
    expect(prominent).toBeGreaterThan(buried);
  });

  it("combines every signal into the maximum multiplier (1.6x base)", () => {
    const bid = computeCompetitorBid(
      { bsr: 100, price: 25, competitorCount: 10, meanRank: 1 },
      { baseBid: 0.5 }
    );
    expect(bid).toBeCloseTo(0.5 * 1.6, 2);
  });

  it("clamps to the max when the scaled bid exceeds the range", () => {
    const bid = computeCompetitorBid(
      { bsr: 100, price: 25, competitorCount: 10, meanRank: 1 },
      { baseBid: 5 }
    );
    expect(bid).toBe(DEFAULT_COMPETITOR_BID_RANGE.max);
  });

  it("respects a custom base bid and range", () => {
    const bid = computeCompetitorBid({}, { baseBid: 1, range: { min: 0.5, max: 5 } });
    expect(bid).toBeCloseTo(1 * 0.85, 5);
  });

  it("treats non-finite/invalid signals the same as missing ones", () => {
    const invalid = computeCompetitorBid({ bsr: -5, price: NaN, competitorCount: 0, meanRank: -1 });
    const missing = computeCompetitorBid({});
    expect(invalid).toBe(missing);
  });
});
