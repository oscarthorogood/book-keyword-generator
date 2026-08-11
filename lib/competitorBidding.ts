/**
 * Bid decision system (competitor-ASIN enhancements task 2) — computes a
 * suggested per-ASIN product-targeting bid (competitor_asins.bid,
 * sql/16-competitor-asin-status-parity.sql) from the ASIN metadata captured
 * by sql/17-competitor-asin-metadata.sql: price, BSR, and how strongly the
 * "Generate ASINs" crawl backed the ASIN (competitor_count/mean_rank).
 * Modeled on bidTier()'s scoring-tier pattern in lib/keywordCapAndRank.ts —
 * small integer tiers per signal, summed into a multiplier on a base bid —
 * then clamped to a sane range via lib/amazonAds.ts.
 */

import { clampBid, DEFAULT_COMPETITOR_BID_RANGE, type BidRange } from "./amazonAds";

export interface CompetitorBidSignals {
  price?: number | null;
  bsr?: number | null;
  competitorCount?: number | null;
  meanRank?: number | null;
}

export interface ComputeCompetitorBidOptions {
  /** Starting bid before signal multipliers. Default 0.50, matching the keyword pipeline's default bid. */
  baseBid?: number;
  /** Clamp range. Defaults to DEFAULT_COMPETITOR_BID_RANGE. */
  range?: BidRange;
}

/** Lower BSR = stronger seller = a more valuable product-targeting placement. */
function bsrTier(bsr: number | null | undefined): number {
  if (bsr === null || bsr === undefined || !Number.isFinite(bsr) || bsr <= 0) return 0;
  if (bsr <= 5_000) return 3;
  if (bsr <= 25_000) return 2;
  if (bsr <= 100_000) return 1;
  return 0;
}

/** A pricier comp implies a reader willing to spend more — a small nudge, not a dominant signal. */
function priceTier(price: number | null | undefined): number {
  if (price === null || price === undefined || !Number.isFinite(price) || price <= 0) return 0;
  if (price >= 12) return 2;
  if (price >= 6) return 1;
  return 0;
}

/** More discovery sources agreeing on this ASIN means more confidence it's a real, relevant competitor. */
function competitorCountTier(count: number | null | undefined): number {
  if (!count || count <= 1) return 0;
  if (count >= 4) return 3;
  if (count >= 2) return 1;
  return 0;
}

/** A lower average discovery position means the ASIN surfaced early/prominently across sources. */
function meanRankTier(meanRank: number | null | undefined): number {
  if (meanRank === null || meanRank === undefined || !Number.isFinite(meanRank) || meanRank <= 0) return 0;
  if (meanRank <= 3) return 2;
  if (meanRank <= 10) return 1;
  return 0;
}

/**
 * Sums the four signal tiers (0-10 total) into a bid multiplier and applies
 * it to the base bid, then clamps to the configured/default range. Pure and
 * deterministic — safe to call both at generation time (per new ASIN) and
 * from the bulk "recalculate bids" action (over every tracked ASIN).
 */
export function computeCompetitorBid(
  signals: CompetitorBidSignals,
  options: ComputeCompetitorBidOptions = {}
): number {
  const baseBid = options.baseBid ?? 0.5;
  const range = options.range ?? DEFAULT_COMPETITOR_BID_RANGE;

  const tierTotal =
    bsrTier(signals.bsr) +
    priceTier(signals.price) +
    competitorCountTier(signals.competitorCount) +
    meanRankTier(signals.meanRank);

  // 0 tier points (no/weak signal) -> 0.85x; 10 tier points (max) -> 1.6x.
  const multiplier = 0.85 + tierTotal * 0.075;

  const bid = Math.round(baseBid * multiplier * 100) / 100;
  return clampBid(bid, range);
}
