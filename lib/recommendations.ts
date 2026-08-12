/**
 * Post-launch bid/archive/promotion recommendations (campaigns spec §6).
 * Deliberately separate from the pre-launch estimators (`computeCompetitorBid()`,
 * generation-time `suggestedBid` tiering in lib/keywordCapAndRank.ts) — this
 * never fires before a row has real results. Reuses `clampBid()` /
 * `DEFAULT_COMPETITOR_BID_RANGE` from lib/amazonAds.ts so it can never
 * propose a bid outside the sane range.
 *
 * Four rules the spec calls out as having burned earlier drafts:
 * 1. One window per rule, named: archive reads LIFETIME clicks/orders; bid
 *    moves read the LAST PERIOD. Mixing them — lifetime clicks against
 *    last-period orders — archives a keyword that simply had a quiet week,
 *    at confidence 'high'.
 * 2. Returns Recommendation[], not one-or-null: an early-return chain means
 *    only the first applicable rule ever surfaces.
 * 3. Reads the caller-supplied targetAcos (books.target_acos), not a
 *    hardcoded 30%.
 * 4. Cooldown: shouldSuppressRecommendation() suppresses a rejected type for
 *    30 days per entity (decision 7, docs/CAMPAIGNS-PROGRESS.md).
 */

import { clampBid, DEFAULT_COMPETITOR_BID_RANGE } from "./amazonAds";
import type { CampaignType } from "./campaignSelection";

export type RecommendationType =
  | "increase_bid"
  | "decrease_bid"
  | "archive"
  | "reactivate"
  | "pause"
  | "promote_to_alpha_exact";

export type Confidence = "low" | "medium" | "high";

export interface Recommendation {
  keywordId?: string;
  competitorAsinId?: string;
  type: RecommendationType;
  currentBid?: number | null;
  suggestedBid?: number;
  confidence: Confidence;
  reason: string;
}

/** A keyword or competitor ASIN joined with its lifetime + last-period performance (sql/24's view + last_* cache). */
export interface KeywordPerformance {
  id: string;
  bid: number | null;
  status: "active" | "paused" | "negative" | "archived" | "rejected";
  /** BMM Discovery keywords are the only ones eligible for promote_to_alpha_exact. Always null for competitor ASINs. */
  campaignType?: CampaignType | null;
  /** Null before any Search Term Report has ever matched this row — no opinion before real data. */
  resultsUpdatedAt: string | null;
  lifetimeClicks: number | null;
  lifetimeOrders: number | null;
  lifetimeSpend: number | null;
  lastClicks: number | null;
  lastSpend: number | null;
  lastSales: number | null;
  lastOrders: number | null;
}

export const MIN_CLICKS_FOR_BID_CHANGE = 20;
export const MIN_CLICKS_FOR_ARCHIVE = 30;
/** A keyword earning this many lifetime orders from BMM Discovery has proven itself — promote it to a guaranteed Exact slot. */
export const MIN_ORDERS_FOR_PROMOTION = 3;
/** How far above/below target ACOS before a bid move fires — a 33% band avoids chasing normal week-to-week noise. */
const ACOS_BAND = 1.33;

const SEVERITY_ORDER: Record<RecommendationType, number> = {
  archive: 5,
  promote_to_alpha_exact: 4,
  decrease_bid: 3,
  pause: 3,
  reactivate: 2,
  increase_bid: 1,
};

function computeAcos(spend: number | null | undefined, sales: number | null | undefined): number | null {
  if (spend === null || spend === undefined || sales === null || sales === undefined || sales <= 0) return null;
  return spend / sales;
}

function fmt(value: number | null | undefined): string {
  return (value ?? 0).toFixed(2);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

/** Shared rule set for both a keyword and a competitor ASIN — see recommendForKeyword/recommendForCompetitorAsin. */
function recommend(
  entity: KeywordPerformance,
  targetAcos: number,
  idField: "keywordId" | "competitorAsinId",
  allowPromotion: boolean
): Recommendation[] {
  if (!entity.resultsUpdatedAt) return [];

  const out: Recommendation[] = [];
  const idValue = { [idField]: entity.id } as Pick<Recommendation, "keywordId" | "competitorAsinId">;

  if (allowPromotion && entity.campaignType === "bmm_discovery" && (entity.lifetimeOrders ?? 0) >= MIN_ORDERS_FOR_PROMOTION) {
    out.push({
      ...idValue,
      type: "promote_to_alpha_exact",
      confidence: "high",
      reason: `${entity.lifetimeOrders} orders from BMM Discovery — meets the ${MIN_ORDERS_FOR_PROMOTION}-sale promotion rule`,
    });
  }

  const lifetimeClicks = entity.lifetimeClicks ?? 0;
  const lifetimeOrders = entity.lifetimeOrders ?? 0;

  if (lifetimeClicks >= MIN_CLICKS_FOR_ARCHIVE && lifetimeOrders === 0 && (entity.lifetimeSpend ?? 0) > 0) {
    out.push({
      ...idValue,
      type: "archive",
      currentBid: entity.bid,
      confidence: "high",
      reason: `${lifetimeClicks} lifetime clicks, ${fmt(entity.lifetimeSpend)} lifetime spend, 0 lifetime orders`,
    });
  }

  const acos = computeAcos(entity.lastSpend, entity.lastSales);
  if (lifetimeClicks >= MIN_CLICKS_FOR_BID_CHANGE && acos !== null && entity.bid !== null) {
    if (acos > targetAcos * ACOS_BAND) {
      out.push({
        ...idValue,
        type: "decrease_bid",
        currentBid: entity.bid,
        suggestedBid: clampBid(entity.bid * 0.8, DEFAULT_COMPETITOR_BID_RANGE),
        confidence: "high",
        reason: `Last-period ACOS ${pct(acos)} vs target ${pct(targetAcos)}`,
      });
    } else if (acos < targetAcos / ACOS_BAND && (entity.lastOrders ?? 0) > 0) {
      out.push({
        ...idValue,
        type: "increase_bid",
        currentBid: entity.bid,
        suggestedBid: clampBid(entity.bid * 1.2, DEFAULT_COMPETITOR_BID_RANGE),
        confidence: "medium",
        reason: `Last-period ACOS ${pct(acos)} well under target`,
      });
    }
  }

  return out.sort((a, b) => SEVERITY_ORDER[b.type] - SEVERITY_ORDER[a.type]);
}

export function recommendForKeyword(keyword: KeywordPerformance, targetAcos: number): Recommendation[] {
  return recommend(keyword, targetAcos, "keywordId", true);
}

/** Same rules as recommendForKeyword, minus promote_to_alpha_exact (BMM Discovery is a keyword-only campaign type). */
export function recommendForCompetitorAsin(asin: KeywordPerformance, targetAcos: number): Recommendation[] {
  return recommend(asin, targetAcos, "competitorAsinId", false);
}

export const RECOMMENDATION_COOLDOWN_DAYS = 30;

export interface PastRecommendation {
  type: RecommendationType;
  status: "pending" | "accepted" | "rejected" | "superseded";
  decidedAt: string | null;
}

/**
 * True when a recommendation of this type was rejected for this entity
 * within the cooldown window — regeneration should skip it rather than
 * immediately re-raising the same suggestion the user just turned down.
 */
export function shouldSuppressRecommendation(
  type: RecommendationType,
  pastRecommendations: PastRecommendation[],
  now: Date = new Date(),
  cooldownDays: number = RECOMMENDATION_COOLDOWN_DAYS
): boolean {
  const cutoff = now.getTime() - cooldownDays * 24 * 60 * 60 * 1000;
  return pastRecommendations.some(
    (rec) => rec.type === type && rec.status === "rejected" && rec.decidedAt !== null && new Date(rec.decidedAt).getTime() >= cutoff
  );
}
