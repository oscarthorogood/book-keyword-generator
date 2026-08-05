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
export function computeMaxCpc(economics: BidEconomics): number {
  const netRevenuePerSale = economics.rrp * NET_MARGIN_RATE;
  const maxSpendPerSale = netRevenuePerSale * economics.targetAcos;
  const maxCpc = maxSpendPerSale * economics.estConversionRate;
  return Math.round(maxCpc * 100) / 100;
}

/** Match-type bid multipliers: exact match earns the full CPC ceiling (highest intent), broad gets discounted. */
export const MATCH_TYPE_BID_MULTIPLIER: Record<"broad" | "phrase" | "exact", number> = {
  exact: 1,
  phrase: 0.85,
  broad: 0.7,
};
