/**
 * Budget-aware keyword capping (Phase 2.2).
 *
 * Problem: A $10/day budget + 150 keywords across all match types = overspend.
 * System should recommend how many keywords fit in the budget.
 *
 * Solution: Calculate max keywords based on:
 * - Daily budget
 * - Average bid (from RRP-derived economics or manual default)
 * - Match-type strategy (1x, 2x, or 3x row multiplier)
 * - Realistic daily spend model (some keywords don't get clicks)
 *
 * Output: Recommended keyword cap + overflow set for "Phase 2 Expansion" later.
 */

import { KeywordCandidate, MatchTypeStrategy } from "./types";
import { MATCH_TYPE_STRATEGIES } from "./matchTypeStrategy";
import { round2 } from "./bidding";

export interface BudgetCapResult {
  /** Maximum keywords that fit in daily budget (rounded down) */
  maxKeywords: number;
  /** Recommended minimum for good coverage (domain knowledge) */
  minRecommended: number;
  /** Safe range to avoid overspend */
  recommendedRange: [min: number, max: number];
  /** Keywords selected to fit budget (sorted by score, highest first) */
  selectedKeywords: KeywordCandidate[];
  /** Keywords that exceed budget (overflow for Phase 2 expansion) */
  overflowKeywords: KeywordCandidate[];
  /** Explanation of calculation for UI display */
  explanation: string;
}

/**
 * Conservative estimate of daily spend as % of bid budget.
 * Not all keywords get impressions/clicks each day, so actual spend
 * is typically 30-60% of "full budget if all keywords got equal traffic".
 * We use 50% as middle estimate for recommendation purposes.
 */
const DAILY_SPEND_UTILIZATION = 0.5;

/**
 * Calculate maximum number of keywords that fit within a daily budget.
 *
 * Factors:
 * - baseBid: Average CPC from bid economics or manual default
 * - dailyBudget: Campaign daily budget limit
 * - rowMultiplier: From match-type strategy (1x phrase, 2x phrase+exact, 3x all)
 * - utilizationRate: Percent of budget typically spent (0.5 = 50%)
 *
 * Formula:
 *   maxKeywords = floor((dailyBudget * utilizationRate) / (baseBid * rowMultiplier))
 *
 * Example:
 *   - dailyBudget = $10
 *   - baseBid = $0.15
 *   - strategy = "phrase-only" (rowMultiplier = 1)
 *   - maxKeywords = floor(($10 * 0.5) / ($0.15 * 1)) = floor(33.3) = 33 keywords
 *
 *   - Same but strategy = "all" (rowMultiplier = 3)
 *   - maxKeywords = floor(($10 * 0.5) / ($0.15 * 3)) = floor(11.1) = 11 keywords
 */
export function calculateMaxKeywords(
  baseBid: number,
  dailyBudget: number,
  matchTypeStrategy?: MatchTypeStrategy,
  utilizationRate: number = DAILY_SPEND_UTILIZATION
): number {
  const resolved = matchTypeStrategy ?? "all";
  const rowMultiplier = MATCH_TYPE_STRATEGIES[resolved].rowMultiplier;

  const estimatedDailyBudgetForKeywords = dailyBudget * utilizationRate;
  const costPerKeywordRow = baseBid * rowMultiplier;

  const maxKeywords = Math.floor(estimatedDailyBudgetForKeywords / costPerKeywordRow);

  return Math.max(1, maxKeywords); // At least 1 keyword
}

/**
 * Recommend a safe keyword range for a given budget.
 * Returns [min, max] where min is conservative and max is aggressive.
 *
 * - Min: 30% of calculated max (very conservative, low risk of overspend)
 * - Max: 100% of calculated max (aggressive, uses full budget)
 */
export function recommendedKeywordRange(
  baseBid: number,
  dailyBudget: number,
  matchTypeStrategy?: MatchTypeStrategy
): [min: number, max: number] {
  const max = calculateMaxKeywords(baseBid, dailyBudget, matchTypeStrategy);
  const min = Math.max(1, Math.floor(max * 0.3)); // At least 30% of max

  return [min, max];
}

/**
 * Cap a keyword list to fit within budget, prioritizing by score.
 * Returns both selected (fits budget) and overflow (didn't fit) sets.
 */
export function capKeywordsToBudget(
  keywords: KeywordCandidate[],
  baseBid: number,
  dailyBudget: number,
  matchTypeStrategy?: MatchTypeStrategy
): BudgetCapResult {
  const maxKeywords = calculateMaxKeywords(baseBid, dailyBudget, matchTypeStrategy);
  const [minRecommended, maxRecommended] = recommendedKeywordRange(
    baseBid,
    dailyBudget,
    matchTypeStrategy
  );

  // Sort by score (descending) — keep highest-confidence keywords
  const sorted = [...keywords].sort((a, b) => {
    const scoreA = a.score ?? 0;
    const scoreB = b.score ?? 0;
    return scoreB - scoreA;
  });

  const selectedKeywords = sorted.slice(0, maxKeywords);
  const overflowKeywords = sorted.slice(maxKeywords);

  const resolved = matchTypeStrategy ?? "all";
  const rowMultiplier = MATCH_TYPE_STRATEGIES[resolved].rowMultiplier;
  const totalRows = selectedKeywords.length * rowMultiplier;
  const estimatedDailySpend = round2(selectedKeywords.length * baseBid * DAILY_SPEND_UTILIZATION);

  const explanation =
    selectedKeywords.length === keywords.length
      ? `All ${keywords.length} keywords fit comfortably within your $${dailyBudget}/day budget (~$${estimatedDailySpend}/day estimated spend).`
      : `Capped to ${selectedKeywords.length} keywords (${totalRows} rows with ${resolved} strategy) to stay within your $${dailyBudget}/day budget (~$${estimatedDailySpend}/day estimated spend). ${overflowKeywords.length} keywords saved for Phase 2 expansion.`;

  return {
    maxKeywords,
    minRecommended,
    recommendedRange: [minRecommended, maxRecommended],
    selectedKeywords,
    overflowKeywords,
    explanation,
  };
}

/**
 * Check if a keyword set is within budget without needing to cap it.
 * Returns true if all keywords fit, false if overflow exists.
 */
export function fitsWithinBudget(
  keywordCount: number,
  baseBid: number,
  dailyBudget: number,
  matchTypeStrategy?: MatchTypeStrategy
): boolean {
  const maxKeywords = calculateMaxKeywords(baseBid, dailyBudget, matchTypeStrategy);
  return keywordCount <= maxKeywords;
}

/**
 * Calculate estimated daily spend for a keyword set.
 * Used for UI warnings and decision-making.
 *
 * Estimate: (keywords.length * baseBid) * utilizationRate
 *
 * Note: This is an estimate. Actual spend depends on:
 * - Keyword competition (less competitive = fewer clicks)
 * - Quality score (affects ad rank and CPCs)
 * - Budget allocation per match type
 * - Time of day, seasonality, etc.
 */
export function estimateDailySpend(
  keywordCount: number,
  baseBid: number,
  matchTypeStrategy?: MatchTypeStrategy,
  utilizationRate: number = DAILY_SPEND_UTILIZATION
): number {
  const resolved = matchTypeStrategy ?? "all";
  const rowMultiplier = MATCH_TYPE_STRATEGIES[resolved].rowMultiplier;
  const totalRows = keywordCount * rowMultiplier;
  const estimated = totalRows * baseBid * utilizationRate;
  return round2(estimated);
}
