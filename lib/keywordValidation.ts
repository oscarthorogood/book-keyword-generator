/**
 * Keyword validation and filtering to prevent low-quality keywords from
 * inflating ad group budgets. Runs after scoring but before final selection.
 *
 * Issues addressed:
 * 1. Generic single-word keywords (too broad)
 * 2. Format-only keywords dominating budget
 * 3. Redundant keywords across match types
 * 4. Suspiciously long keywords (full book titles)
 */

import { KeywordCandidate } from "./types";

/**
 * Too-generic keywords that appear commonly but rarely lead to purchases.
 * These are already filtered at candidate generation, but double-check
 * before final output to catch edge cases.
 */
const ULTRA_GENERIC_KEYWORDS = new Set([
  "audiobook",
  "audiobook books",
  "kindle books",
  "ebook",
  "book",
  "books",
  "novel",
  "novels",
  "fiction",
  "story",
  "stories",
  "read",
  "reading",
  "series",
]);

/**
 * Format-only keywords that don't add thematic value. These should be
 * de-prioritized in favor of content-based keywords (mystery, romance, etc).
 */
const FORMAT_ONLY_KEYWORDS = new Set([
  "audiobook",
  "audiobook books",
  "kindle books",
  "kindle unlimited books",
  "ebook",
  "large print books",
  "hardcover",
  "paperback",
  "hardback",
]);

/**
 * Quality check: Is this keyword likely to perform well?
 * Returns scoring adjustment (0 = no change, negative = penalize).
 */
export function getKeywordQualityAdjustment(text: string): number {
  const lower = text.toLowerCase();

  // Hard block: ultra-generic single words
  if (/^\w+$/.test(lower) && ULTRA_GENERIC_KEYWORDS.has(lower)) {
    return -10; // Penalize heavily
  }

  // Soft penalty: format-only keywords
  if (FORMAT_ONLY_KEYWORDS.has(lower)) {
    return -2; // Reduce score
  }

  // Soft penalty: suspiciously long (full book titles as keywords)
  // A 13-word keyword is probably a scraped full title, not a search phrase
  const wordCount = lower.split(/\s+/).length;
  if (wordCount > 11) {
    return -3; // Penalize very long keywords
  }

  // No penalty
  return 0;
}

/**
 * Filter out redundant keywords. If "cozy mystery" appears in Broad, Phrase,
 * AND Exact match types, keep the highest-performing one (usually Exact)
 * and drop duplicates to avoid wasting budget on the same keyword.
 */
export function filterRedundantMatches(
  candidates: KeywordCandidate[],
  matchTypes: string[]
): KeywordCandidate[] {
  if (matchTypes.length <= 1) return candidates;

  // Group candidates by keyword text (case-insensitive)
  const byKeyword = new Map<string, KeywordCandidate[]>();
  for (const candidate of candidates) {
    const normalized = candidate.text.toLowerCase();
    if (!byKeyword.has(normalized)) {
      byKeyword.set(normalized, []);
    }
    byKeyword.get(normalized)!.push(candidate);
  }

  // For each keyword that appears multiple times with different match types,
  // keep only the highest-scoring version
  const result: KeywordCandidate[] = [];
  for (const variants of byKeyword.values()) {
    if (variants.length === 1) {
      result.push(variants[0]);
    } else {
      // Multiple match types for same keyword - keep the best one
      const best = variants.reduce((prev, curr) =>
        (curr.score ?? 0) > (prev.score ?? 0) ? curr : prev
      );
      result.push(best);
    }
  }

  return result;
}

/**
 * Restructure keyword output to allocate budget better:
 * - Reduce format-heavy keywords
 * - Boost content/theme keywords
 * - Remove ultra-generic single-word terms
 */
export function rebalanceKeywordBudget(
  candidates: KeywordCandidate[],
  defaultBid: number
): KeywordCandidate[] {
  return candidates
    .map((candidate) => {
      const qualityAdjust = getKeywordQualityAdjustment(candidate.text);

      if (qualityAdjust < -5) {
        // Ultra-generic: block entirely
        return null;
      }

      if (qualityAdjust < 0) {
        // Reduce score and bid
        const newScore = Math.max(0, (candidate.score ?? 0) + qualityAdjust);
        const bidMultiplier = Math.max(0.3, 1 + qualityAdjust / 10);
        // Falls back to the ad group's base bid rather than leaving the bid
        // unset — a penalized keyword still needs a bid to be exportable.
        const baseBid = candidate.suggestedBid ?? defaultBid;
        const newBid = Math.round(baseBid * bidMultiplier * 100) / 100;
        return { ...candidate, score: newScore, suggestedBid: newBid };
      }

      return candidate;
    })
    .filter((k): k is KeywordCandidate => k !== null);
}

/**
 * Check if keyword looks like it was over-extracted (e.g., full book title).
 * Book titles as keywords rarely match real searches since searchers don't
 * type the full title when searching.
 */
export function isLikelyFullTitle(text: string, maxWordCount: number = 12): boolean {
  const words = text.split(/\s+/).length;

  // Past the cap is almost certainly a full title/description scrape
  if (words > maxWordCount) return true;

  // Just under it: probably a full title if it carries subtitle punctuation
  // ("The Silent Patient: The Record-Breaking ... Thriller").
  if (words >= maxWordCount - 1) {
    if (/[:"';,]/.test(text)) return true;
  }

  return false;
}

/**
 * Recommended final keyword refinement pass:
 * Apply all quality checks and return a validated keyword list.
 */
export function validateFinalKeywords(
  candidates: KeywordCandidate[],
  defaultBid: number
): KeywordCandidate[] {
  // First pass: quality adjustment (score/bid rebalancing)
  let result = rebalanceKeywordBudget(candidates, defaultBid);

  // Second pass: drop over-extracted scrapes. Readers don't type a book's
  // full title-plus-subtitle into search, so those never match and just
  // dilute the ad group. Safe for the comparable-titles group too: a real
  // comp title ("gone girl") is nowhere near the word-count threshold.
  result = result.filter((candidate) => !isLikelyFullTitle(candidate.text));

  // Third pass: sort by final score
  result = result.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  // Return the validated list
  return result;
}
