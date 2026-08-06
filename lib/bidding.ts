import { BidEconomics } from "./types";

/**
 * Net margin rate used by the downstream monitoring tracker: Net RRP = RRP x 0.4.
 * ROI there is computed off net revenue, not list price, so bidding off RRP
 * directly overstates what a click is worth — this derives spend caps from
 * the same net-margin basis the tracker already uses.
 */
export const NET_MARGIN_RATE = 0.4;

/**
 * Max sustainable CPC, derived from net margin, target ACOS, and expected
 * conversion rate.
 *
 * Source learnings doc states this as
 * `(Net revenue per sale x target ACOS) / expected conversion rate`, but that
 * divides by a fraction less than 1, which *inflates* CPC above the max spend
 * per sale -- backwards. Re-deriving from the definitions actually in use:
 *   - ACOS = Spend / Revenue, so max spend per sale = netRevenuePerSale x targetAcos
 *   - a sale takes on average 1 / conversionRate clicks
 *   - so max spend per click = (max spend per sale) x conversionRate
 * i.e. multiply by conversion rate, not divide. That's what this implements;
 * flagging the discrepancy here since it deviates from the literal wording.
 */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeMaxCpc(economics: BidEconomics): number {
  const netRevenuePerSale = economics.rrp * NET_MARGIN_RATE;
  const maxSpendPerSale = netRevenuePerSale * economics.targetAcos;
  const maxCpc = maxSpendPerSale * economics.estConversionRate;
  return round2(maxCpc);
}

/** Match-type bid multipliers: exact match earns the full CPC ceiling (highest intent), broad gets discounted. */
export const MATCH_TYPE_BID_MULTIPLIER: Record<"broad" | "phrase" | "exact", number> = {
  exact: 1,
  phrase: 0.85,
  broad: 0.7,
};

/**
 * Per-ad-group default bid multipliers for the Manual campaign's 3-way
 * category split (research blueprint, section 5). Comp-name searches are
 * the highest-intent signal ("readers actively looking for their next
 * read"), product targeting places the ad directly on a competitor's page
 * (also high-intent), tropes/themes are the exploratory end — the blueprint
 * says start those at a moderate bid and earn the way up once real
 * performance data shows which ones convert. These weights are a judgment
 * call, not sourced from either doc.
 */
export const AD_GROUP_BID_MULTIPLIER: Record<"tropes" | "comp-names" | "product-targeting", number> = {
  "comp-names": 1,
  "product-targeting": 0.9,
  tropes: 0.75,
};
