/**
 * Match-type strategy implementation (Phase 2.1).
 *
 * Different books benefit from different match-type allocations:
 * - Niche genres with thin keyword data: phrase-only (conservative, lower cost)
 * - Mid-market books: phrase-exact (balanced coverage + cost)
 * - Competitive genres: all three (saturate keyword space)
 *
 * See ARCHITECTURE.md §2.1 for rationale.
 */

import { MatchType, MatchTypeStrategy } from "./types";

/**
 * Strategy definitions with metadata.
 */
export const MATCH_TYPE_STRATEGIES: Record<
  MatchTypeStrategy,
  {
    label: string;
    description: string;
    matchTypes: MatchType[];
    rowMultiplier: number; // Relative to base keyword count
    riskLevel: "conservative" | "balanced" | "aggressive";
  }
> = {
  "phrase-only": {
    label: "Phrase Only (Conservative)",
    description: "Single match type. Best for niche books or tight budgets. 1/3 row count, lower cost.",
    matchTypes: ["phrase"],
    rowMultiplier: 1,
    riskLevel: "conservative",
  },
  "phrase-exact": {
    label: "Phrase + Exact (Balanced)",
    description: "Two match types. Good balance of coverage and cost. 2/3 row count.",
    matchTypes: ["phrase", "exact"],
    rowMultiplier: 2,
    riskLevel: "balanced",
  },
  all: {
    label: "All Types: Broad + Phrase + Exact (Aggressive)",
    description: "All three match types. Maximum coverage. 3x row count, highest cost.",
    matchTypes: ["broad", "phrase", "exact"],
    rowMultiplier: 3,
    riskLevel: "aggressive",
  },
};

/**
 * Resolve a strategy to the match types that should be included.
 * If strategy is not provided, defaults to "all" (backward compat).
 */
export function resolveStrategy(strategy?: MatchTypeStrategy): MatchType[] {
  const resolved = strategy ?? "all";
  return MATCH_TYPE_STRATEGIES[resolved].matchTypes;
}

/**
 * Estimate the row impact of a strategy choice.
 * Example: phrase-only adds ~100 rows, phrase-exact adds ~200, all adds ~300.
 */
export function estimateRowMultiplier(strategy?: MatchTypeStrategy): number {
  const resolved = strategy ?? "all";
  return MATCH_TYPE_STRATEGIES[resolved].rowMultiplier;
}

/**
 * Recommend a strategy based on book metadata.
 * Heuristic: niche books → conservative, competitive genres → aggressive.
 *
 * For Phase 2.1, this returns "all" (backward compat).
 * Phase 3 can implement smarter heuristics using historical ACOS data.
 */
export function recommendStrategy(
  _bestSellerRank?: number,
  _competitorCount?: number,
  _reviewCount?: number
): MatchTypeStrategy {
  // Placeholder for Phase 3 intelligence
  // Could use BSR, competitor density, review velocity to recommend strategy
  return "all";
}

/**
 * Get user-friendly text explaining the cost/keyword implications of a strategy.
 */
export function describeStrategyImpact(strategy?: MatchTypeStrategy): string {
  const resolved = strategy ?? "all";
  const config = MATCH_TYPE_STRATEGIES[resolved];
  const rowText = config.rowMultiplier === 1 ? "~100" : config.rowMultiplier === 2 ? "~200" : "~300";
  return `${config.matchTypes.join("/")} match types · ${rowText} rows per 100 keywords`;
}
