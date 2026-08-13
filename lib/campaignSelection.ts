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

/**
 * Every campaign's target count is kept in [MIN_CAMPAIGN_TARGETS,
 * MAX_CAMPAIGN_TARGETS] (user request on top of spec §3) — Update Campaign
 * already enforced this range when swapping in "ready" replacements
 * (lib/campaignRebalance.ts); Create Campaign now enforces the same range
 * when a campaign is first built, instead of each selector's smaller
 * fixed cap under-filling the campaign while the book's "ready" bank sits
 * unused.
 */
export const MIN_CAMPAIGN_TARGETS = 15;
export const MAX_CAMPAIGN_TARGETS = 25;

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
 * A bank row's `match_type` is only a *suggestion* from whichever source
 * produced it ("when the source has an opinion" — lib/types.ts), and most
 * sources have none. Treating it as a hard eligibility filter was what
 * under-filled the keyword campaigns: a book whose bank held 300 usable
 * terms but only two rows suggesting `exact` shipped an Alpha Exact
 * campaign with two keywords in it.
 *
 * Match type belongs to the *campaign*, not to the keyword — Alpha Exact is
 * exact because it is Alpha Exact. So the selectors below rank rows that
 * already suggest the campaign's match type first, then fall back to the
 * rest of the eligible bank, and stamp the campaign's match type onto
 * whatever they return.
 */
function withMatchType<T extends CampaignKeyword>(keyword: T, matchType: MatchType): T {
  return keyword.matchType === matchType ? keyword : { ...keyword, matchType };
}

/** Rows whose suggested match type is one of `preferred`, first; everything else after, each group's relative order kept. */
function preferMatchTypes<T extends CampaignKeyword>(rows: T[], preferred: MatchType[]): T[] {
  const suggested = rows.filter((k) => k.matchType !== undefined && preferred.includes(k.matchType));
  const rest = rows.filter((k) => k.matchType === undefined || !preferred.includes(k.matchType));
  return [...suggested, ...rest];
}

/**
 * 1. Brand Guard — author/title/series/typos, Exact + Phrase. Filters by
 * brand-ness *before* slicing (the spec's named bug: filtering after
 * slicing can return fewer than the cap even when enough eligible
 * candidates exist).
 *
 * Every brand term the book has is eligible regardless of its suggested
 * match type; ones already suggesting Exact/Phrase lead, and the rest are
 * stamped Phrase (the safer of the two for a term the source had no
 * opinion about). Brand Guard is still only as big as the book's stock of
 * brand terms — it is never padded with generic keywords, which would
 * defeat the campaign's purpose.
 *
 * Deviates from the spec's pseudocode in one place: it checks
 * `k.category === "comp-name"`, but `"comp-name"` isn't a `KeywordCategory`
 * value (see lib/types.ts) — it's a `KeywordSource`, and
 * lib/keywordCapAndRank.ts's `adGroupOf()` already keys off it the same way
 * this does (`sources.includes("comp-name")`). The code wins.
 */
export function selectBrandGuardKeywords(
  bank: CampaignKeyword[],
  book: CampaignBook,
  limit: number = MAX_CAMPAIGN_TARGETS
): CampaignKeyword[] {
  const filtered = bank.filter(
    (k) =>
      (k.sources ?? []).includes("comp-name") ||
      isAuthorOrTitleVariant(k.text, book.author, book.title) ||
      isCommonTypo(k.text, book.author)
  );
  return dedupeByText(preferMatchTypes(filtered, BRAND_GUARD_MATCH_TYPES))
    .slice(0, limit)
    .map((k) => (k.matchType && BRAND_GUARD_MATCH_TYPES.includes(k.matchType) ? k : withMatchType(k, "phrase")));
}

/**
 * 2. Alpha Exact — result history wins; scoreForRank breaks pre-launch ties.
 * Rows already suggesting Exact lead; the rest of the active bank backs
 * them up so the campaign fills to its cap whenever the book has the terms
 * to fill it.
 *
 * The backfill deliberately stops short of rows suggesting Broad. A source
 * that says "broad" is saying this is a wide root term — poor exact-match
 * material, and exactly what BMM Discovery is built from. Since BMM
 * excludes everything Alpha Exact takes (spec §3), letting the backfill
 * claim them would fill this campaign by emptying that one.
 */
export function selectAlphaExactKeywords(
  bank: KeywordWithRollups[],
  anchors: BookAnchors,
  limit: number = MAX_CAMPAIGN_TARGETS
): KeywordWithRollups[] {
  const ranked = bank
    .filter((k) => k.status === "active" && k.matchType !== "broad")
    .sort(
      (a, b) =>
        (b.lifetimeOrders ?? 0) - (a.lifetimeOrders ?? 0) ||
        scoreForRank(b, anchors) - scoreForRank(a, anchors) ||
        (b.specificity ?? 0) - (a.specificity ?? 0)
    );
  return dedupeByText(preferMatchTypes(ranked, ["exact"]))
    .slice(0, limit)
    .map((k) => withMatchType(k, "exact"));
}

export interface BmmDiscoveryTarget {
  text: string;
  rootKeywordId: string;
}

const BMM_MAX_SPECIFICITY = 2;

/**
 * 3. BMM Discovery — root terms, excluding anything in Alpha Exact or Brand
 * Guard. The low-specificity guard is real (a 5-word long-tail is not a
 * discovery root) and stays; the suggested match type is not, so rows
 * suggesting Broad merely lead the ordering.
 */
export function selectBmmDiscoveryKeywords(
  bank: CampaignKeyword[],
  alphaExact: CampaignKeyword[],
  brandGuard: CampaignKeyword[],
  limit: number = MAX_CAMPAIGN_TARGETS
): BmmDiscoveryTarget[] {
  const excluded = new Set([...alphaExact, ...brandGuard].map((k) => normalizeKeyword(k.text)));
  const roots = bank.filter(
    (k) =>
      k.status === "active" &&
      (k.specificity ?? 3) <= BMM_MAX_SPECIFICITY &&
      !excluded.has(normalizeKeyword(k.text))
  );
  return dedupeByText(preferMatchTypes(roots, ["broad"]))
    .slice(0, limit)
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
  rules: RivalExclusionRules = DEFAULT_EXCLUSION,
  limit: number = MAX_CAMPAIGN_TARGETS
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
    .slice(0, limit);
}

/** 5. Catalog Cross-Sell — siblings only, no cap. Empty when series_key is unset (never backfilled from author — spec §2.5). */
export function selectCatalogCrossSellTargets(ownBooks: CampaignBook[], currentBook: CampaignBook): CrossSellTarget[] {
  if (!currentBook.series_key) return [];
  return ownBooks
    .filter((b) => b.id !== currentBook.id && b.series_key === currentBook.series_key && b.asin)
    .map((b) => ({ asin: b.asin as string, relationship: "own" as const }));
}
