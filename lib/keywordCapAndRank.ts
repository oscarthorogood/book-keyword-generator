/**
 * Cap-and-rank (brief §5.11) — the final stage after the drop-rule pipeline.
 *
 * Relevance filtering alone still leaves keyword dumping: this scores every
 * surviving candidate, keeps the top `maxKeywordsTotal` (capped further per
 * ad group at `maxPerAdGroup`), and routes everything ranked out to a
 * backlog with reason code RANKED_OUT instead of discarding it — the brief's
 * intent is to rotate backlog keywords back in later as search-term data
 * retires losers.
 *
 * Guaranteed slots (own title/series/author, validated comps, genre-metadata
 * head terms) are reserved before the cap is applied, so a small budget
 * never crowds out the keywords this book cannot afford to be without.
 */

import { profileOf, type BookAnchors } from "./keywordAnchors";
import type { ReasonCode } from "./keywordFilterConfig";
import { normalizeKeyword } from "./keywordFilters";
import type { KeywordCandidate, MatchType } from "./types";

export interface CapAndRankOptions {
  maxKeywordsTotal?: number;
  /** A single cap shared by every ad group, or a cap per ad group when their budgets differ (the book pipeline's descriptive/comp-names split, e.g., is 300/120, not one shared number). */
  maxPerAdGroup?: number | Partial<Record<"descriptive" | "comp-names", number>>;
}

const DEFAULT_MAX_KEYWORDS_TOTAL = 150;
const DEFAULT_MAX_PER_AD_GROUP = 50;

/**
 * Source trust tiers from the brief's §1 table — highest first. Highest:
 * search-term-report/reverse-asin/decodo (proven or scored external signal).
 * High: comp-name/comp-title/persona-llm. Medium: book-description/
 * listing-metadata/storygraph-tags/library-subjects/critics-blurbs. Lowest:
 * serpapi-organic/serpapi-related.
 */
const SOURCE_TIER: Record<string, number> = {
  "search-term-report": 12,
  "reverse-asin": 12,
  decodo: 12,
  "listing-metadata": 10,
  "genre-metadata": 9,
  "comp-name": 9,
  "comp-title": 9,
  "persona-llm": 9,
  "buyer-intent": 8,
  "book-description": 7,
  "storygraph-tags": 7,
  "library-subjects": 7,
  "critics-blurbs": 7,
  "genre-preset": 6,
  "google-autocomplete": 5,
  "youtube-autocomplete": 5,
  "duckduckgo-autocomplete": 5,
  synonym: 4,
  "serpapi-organic": 2,
  "serpapi-related": 2,
};

/**
 * Small bonus for candidates carrying real performance data (Search Term
 * Report clicks/orders) — proven buyer behaviour beats a heuristic score.
 * Scaled by orders, capped at +3 so it nudges rather than dominates ranking.
 */
function performanceBoost(candidate: KeywordCandidate): number {
  if (candidate.orders === undefined && candidate.clicks === undefined) return 0;
  const orders = candidate.orders ?? 0;
  const clicks = candidate.clicks ?? 0;
  const boost = orders * 1 + (clicks > 0 && orders === 0 ? 0.25 : 0);
  return Math.min(3, Math.max(0, boost));
}

const BUYER_INTENT_TOKENS = ["book", "books", "novel", "series", "best", "new", "bestselling"];

function words(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function sourceTrust(sources: string[]): number {
  return Math.max(0, ...sources.map((source) => SOURCE_TIER[source] ?? 3));
}

function bidTier(bid: number | null | undefined): number {
  if (!bid) return 1;
  if (bid >= 0.45) return 3;
  if (bid >= 0.38) return 2;
  return 1;
}

function matchTypeScore(matchType: MatchType | undefined): number {
  if (matchType === "exact") return 3;
  if (matchType === "phrase") return 2;
  return 1;
}

/** Scores one surviving candidate for ranking. Higher is better. */
export function scoreForRank(
  candidate: KeywordCandidate & { matchType?: MatchType; bid?: number | null },
  anchors: BookAnchors
): number {
  const text = normalizeKeyword(candidate.text);
  const tokenCount = words(text).length;

  let score = sourceTrust(candidate.sources ?? []);

  const { genreCore, genreAdjacent } = profileOf(anchors);
  if (genreCore.some((term) => text.includes(term))) score += 4;
  else if (genreAdjacent.some((term) => text.includes(term))) score += 2;

  if (anchors.bookSpecific.some((term) => text.includes(term))) score += 5;
  if (anchors.comps.some((term) => text.includes(term))) score += 3;

  // Specificity sweet spot: 2-4 meaningful tokens read as a real search query.
  if (tokenCount >= 2 && tokenCount <= 4) score += 2;
  else if (tokenCount === 1) score -= 1;
  else if (tokenCount > 6) score -= 1;

  if (BUYER_INTENT_TOKENS.some((token) => text.includes(token))) score += 1;

  score += matchTypeScore(candidate.matchType);
  score += bidTier(candidate.bid);
  score += performanceBoost(candidate);

  return score;
}

/** A candidate is a guaranteed slot when it's this book's own identity, a validated comp, or a genre head term. */
function isGuaranteedSlot(candidate: KeywordCandidate, anchors: BookAnchors): boolean {
  const text = normalizeKeyword(candidate.text);
  const sources = candidate.sources ?? [];
  if (sources.includes("listing-metadata")) return true;
  if (anchors.bookSpecific.some((term) => text === term || text.includes(term))) return true;
  if (sources.includes("comp-name") && anchors.comps.some((term) => text.includes(term))) return true;
  if (sources.includes("genre-metadata") && words(text).length <= 2) return true;
  return false;
}

export interface RankedKeyword extends KeywordCandidate {
  score: number;
  guaranteed: boolean;
  adGroup: "descriptive" | "comp-names";
}

export interface BacklogKeyword extends KeywordCandidate {
  filter: "capAndRank";
  reason: string;
  code: Extract<ReasonCode, "RANKED_OUT">;
}

export interface CapAndRankResult {
  kept: RankedKeyword[];
  backlog: BacklogKeyword[];
}

function adGroupOf(candidate: KeywordCandidate): "descriptive" | "comp-names" {
  return (candidate.sources ?? []).includes("comp-name") ? "comp-names" : "descriptive";
}

function adGroupCap(maxPerAdGroup: CapAndRankOptions["maxPerAdGroup"], adGroup: "descriptive" | "comp-names"): number {
  if (typeof maxPerAdGroup === "number") return maxPerAdGroup;
  return maxPerAdGroup?.[adGroup] ?? DEFAULT_MAX_PER_AD_GROUP;
}

/**
 * Applies the cap: scores every survivor, reserves guaranteed slots, then
 * fills the remaining budget by score within each ad group's own cap.
 */
export function capAndRank(
  candidates: Array<KeywordCandidate & { matchType?: MatchType; bid?: number | null }>,
  anchors: BookAnchors,
  options: CapAndRankOptions = {}
): CapAndRankResult {
  const maxKeywordsTotal = options.maxKeywordsTotal ?? DEFAULT_MAX_KEYWORDS_TOTAL;

  const scored = candidates.map((candidate) => ({
    candidate,
    score: scoreForRank(candidate, anchors),
    guaranteed: isGuaranteedSlot(candidate, anchors),
    adGroup: adGroupOf(candidate),
  }));

  scored.sort((a, b) => b.score - a.score);

  const kept: RankedKeyword[] = [];
  const backlog: BacklogKeyword[] = [];
  const perAdGroupCount: Record<string, number> = { descriptive: 0, "comp-names": 0 };

  // Guaranteed slots first, highest score first within the group.
  for (const entry of scored) {
    if (!entry.guaranteed) continue;
    kept.push({ ...entry.candidate, score: entry.score, guaranteed: true, adGroup: entry.adGroup });
    perAdGroupCount[entry.adGroup] += 1;
  }

  for (const entry of scored) {
    if (entry.guaranteed) continue;

    const groupCap = adGroupCap(options.maxPerAdGroup, entry.adGroup);
    const totalOk = kept.length < maxKeywordsTotal;
    const adGroupOk = perAdGroupCount[entry.adGroup] < groupCap;

    if (totalOk && adGroupOk) {
      kept.push({ ...entry.candidate, score: entry.score, guaranteed: false, adGroup: entry.adGroup });
      perAdGroupCount[entry.adGroup] += 1;
    } else {
      backlog.push({
        ...entry.candidate,
        filter: "capAndRank",
        reason: !totalOk ? `ranked out: over max_keywords_total (${maxKeywordsTotal})` : `ranked out: over max_per_ad_group (${groupCap}) for "${entry.adGroup}"`,
        code: "RANKED_OUT",
      });
    }
  }

  return { kept, backlog };
}

// --- Competitor-keyword slot reservation (docs/CLAUDE-CODE-COMPETITORS.md §4.2) --
