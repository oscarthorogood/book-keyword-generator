/**
 * Selects targets for the 5-campaign structure from a book's keyword and
 * ASIN bank (campaigns spec §3). Pure and deterministic, no I/O — matches
 * the `computeCompetitorBid()` pattern in `lib/competitorBidding.ts`, so
 * it's unit-testable and reusable from a future "reselect" bulk action.
 * Reuses `scoreForRank()` from `lib/keywordCapAndRank.ts` rather than
 * writing a second ranking.
 */

import type { BookAnchors } from "./keywordAnchors";
import { normalizeKeyword } from "./keywordFilters";
import { scoreForRank } from "./keywordCapAndRank";
import type { CompetitorAsin, KeywordCandidate, MatchType } from "./types";

export interface CampaignKeyword extends KeywordCandidate {
  id: string;
  status: "active" | "paused" | "negative" | "archived" | "rejected";
  /** The persisted keywords.bid column — distinct from KeywordCandidate's generation-time suggestedBid. */
  bid?: number | null;
}

/** A campaign keyword joined with its lifetime performance (keyword_result_rollups, sql/24). */
export interface KeywordWithRollups extends CampaignKeyword {
  lifetimeOrders?: number;
}

export type CampaignType =
  | "brand_guard"
  | "alpha_exact"
  | "bmm_discovery"
  | "rival_asin_offensive"
  | "catalog_cross_sell"
  | "auto_discovery";

/**
 * Every campaign type except Auto Discovery has exactly one ad group,
 * named after the campaign type itself. Auto Discovery has one per
 * targeting group (lib/bulksheet.ts's AUTO_TARGETING_GROUPS) and isn't in
 * this map — Update Campaign (PR 9) only supports the single-ad-group
 * types for that reason.
 */
export const SINGLE_AD_GROUP_LABEL: Partial<Record<CampaignType, string>> = {
  brand_guard: "Brand Guard",
  alpha_exact: "Alpha Exact",
  bmm_discovery: "BMM Discovery",
  rival_asin_offensive: "Rival ASIN Offensive",
  catalog_cross_sell: "Catalog Cross-Sell",
};

export interface CampaignBook {
  id: string;
  author: string;
  title: string;
  series_key?: string | null;
  asin?: string | null;
}

export interface CrossSellTarget {
  asin: string;
  relationship: "own";
}

export const CAMPAIGN_CAPS = {
  brandGuard: 15,
  alphaExact: 10,
  bmmDiscovery: 10,
  rivalAsin: 40,
} as const;

/** Amazon has no real BMM match type — ordinary Broad match with '+' prefixed on every mandatory word. */
export function toModifiedBroadSyntax(text: string): string {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (word.startsWith("+") ? word : `+${word}`))
    .join(" ");
}

function dedupeByText<T extends { text: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = normalizeKeyword(item.text);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** True when `haystack` contains `needle` as a whole normalized string (not just any shared word). */
function containsWhole(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.includes(needle);
}

/** A keyword text that names the book by its author or title, in whole (not just a shared common word). */
export function isAuthorOrTitleVariant(text: string, author: string, title: string): boolean {
  const norm = normalizeKeyword(text);
  return containsWhole(norm, normalizeKeyword(author)) || containsWhole(norm, normalizeKeyword(title));
}

/** Levenshtein edit distance, for catching near-misspellings of the author's name. */
function editDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[rows - 1][cols - 1];
}

const MAX_TYPO_DISTANCE = 2;

/** A keyword text that's a near-misspelling of the author's full name. */
export function isCommonTypo(text: string, author: string): boolean {
  const norm = normalizeKeyword(text);
  const normAuthor = normalizeKeyword(author);
  if (!norm || !normAuthor) return false;
  return editDistance(norm, normAuthor) > 0 && editDistance(norm, normAuthor) <= MAX_TYPO_DISTANCE;
}

const BRAND_GUARD_MATCH_TYPES: MatchType[] = ["exact", "phrase"];

/**
 * 1. Brand Guard — author/title/series/typos, Exact + Phrase. Filters by
 * match_type *before* slicing (the spec's named bug: filtering after
 * slicing can return fewer than the cap even when enough eligible
 * candidates exist).
 *
 * Deviates from the spec's pseudocode in one place: it checks
 * `k.category === "comp-name"`, but `"comp-name"` isn't a `KeywordCategory`
 * value (see lib/types.ts) — it's a `KeywordSource`, and
 * lib/keywordCapAndRank.ts's `adGroupOf()` already keys off it the same way
 * this does (`sources.includes("comp-name")`). The code wins.
 */
export function selectBrandGuardKeywords(bank: CampaignKeyword[], book: CampaignBook): CampaignKeyword[] {
  const filtered = bank.filter(
    (k) =>
      k.matchType !== undefined &&
      BRAND_GUARD_MATCH_TYPES.includes(k.matchType) &&
      ((k.sources ?? []).includes("comp-name") ||
        isAuthorOrTitleVariant(k.text, book.author, book.title) ||
        isCommonTypo(k.text, book.author))
  );
  return dedupeByText(filtered).slice(0, CAMPAIGN_CAPS.brandGuard);
}

/** 2. Alpha Exact — result history wins; scoreForRank breaks pre-launch ties. */
export function selectAlphaExactKeywords(bank: KeywordWithRollups[], anchors: BookAnchors): KeywordWithRollups[] {
  return [...bank]
    .filter((k) => k.matchType === "exact" && k.status === "active")
    .sort(
      (a, b) =>
        (b.lifetimeOrders ?? 0) - (a.lifetimeOrders ?? 0) ||
        scoreForRank(b, anchors) - scoreForRank(a, anchors) ||
        (b.specificity ?? 0) - (a.specificity ?? 0)
    )
    .slice(0, CAMPAIGN_CAPS.alphaExact);
}

export interface BmmDiscoveryTarget {
  text: string;
  rootKeywordId: string;
}

const BMM_MAX_SPECIFICITY = 2;

/** 3. BMM Discovery — root terms, excluding anything in Alpha Exact or Brand Guard. */
export function selectBmmDiscoveryKeywords(
  bank: CampaignKeyword[],
  alphaExact: CampaignKeyword[],
  brandGuard: CampaignKeyword[]
): BmmDiscoveryTarget[] {
  const excluded = new Set([...alphaExact, ...brandGuard].map((k) => normalizeKeyword(k.text)));
  return bank
    .filter(
      (k) =>
        k.matchType === "broad" &&
        k.status === "active" &&
        (k.specificity ?? 3) <= BMM_MAX_SPECIFICITY &&
        !excluded.has(normalizeKeyword(k.text))
    )
    .slice(0, CAMPAIGN_CAPS.bmmDiscovery)
    .map((k) => ({ text: toModifiedBroadSyntax(k.text), rootKeywordId: k.id }));
}

export interface RivalExclusionRules {
  maxBsr: number;
  minPrice: number;
}

export const DEFAULT_EXCLUSION: RivalExclusionRules = { maxBsr: 500, minPrice: 2.99 };

/**
 * Excludes top-BSR mega-bestsellers. Independent of price — a v1 draft used
 * `bsr < 500 AND price < 6`, which only excluded books that were *both*
 * top-500 *and* cheap, letting a $14.99 top-10 bestseller straight through.
 */
export function isMegaBestseller(asin: CompetitorAsin, rules: RivalExclusionRules = DEFAULT_EXCLUSION): boolean {
  return asin.bsr !== null && asin.bsr < rules.maxBsr;
}

/** Excludes perma-free/near-free competitors, independent of bestseller rank. */
export function isRaceToBottom(asin: CompetitorAsin, rules: RivalExclusionRules = DEFAULT_EXCLUSION): boolean {
  return asin.price !== null && asin.price < rules.minPrice;
}

/** 4. Rival ASIN Offensive. */
export function selectRivalAsinTargets(
  bank: CompetitorAsin[],
  rules: RivalExclusionRules = DEFAULT_EXCLUSION
): CompetitorAsin[] {
  return bank
    .filter(
      (a) =>
        (a.relationship ?? "rival") === "rival" &&
        a.status === "active" &&
        !isMegaBestseller(a, rules) &&
        !isRaceToBottom(a, rules)
    )
    .sort((a, b) => (a.mean_rank ?? 999) - (b.mean_rank ?? 999))
    .slice(0, CAMPAIGN_CAPS.rivalAsin);
}

/** 5. Catalog Cross-Sell — siblings only, no cap. Empty when series_key is unset (never backfilled from author — spec §2.5). */
export function selectCatalogCrossSellTargets(ownBooks: CampaignBook[], currentBook: CampaignBook): CrossSellTarget[] {
  if (!currentBook.series_key) return [];
  return ownBooks
    .filter((b) => b.id !== currentBook.id && b.series_key === currentBook.series_key && b.asin)
    .map((b) => ({ asin: b.asin as string, relationship: "own" as const }));
}
