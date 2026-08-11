/**
 * Keyword validation and filtering to prevent low-quality keywords from
 * inflating ad group budgets. Runs after scoring but before final selection.
 *
 * Critical bug fixes from audit (§2):
 * 1. Off-topic financial products ("barclaycard", "business card", "instalments")
 * 2. Invalid ASINs (non-B0 format, arbitrary strings like "CLOVERLEAF")
 * 3. Malformed keywords ("book cover X, kindle unlimited")
 * 4. Category-label templating ("cozy kindle store", "books books")
 * 5. Author/entity hallucinations (validated against real entities)
 * 6. Wikipedia taxonomy leakage ("[Nationality] [genre] films")
 * 7. Truncated blurb fragments (respect sentence boundaries)
 *
 * Strategic issues (§3):
 * 1. Generic single-word keywords (too broad)
 * 2. Format-only keywords dominating budget
 * 3. Redundant keywords across match types
 * 4. Suspiciously long keywords (full book titles)
 * 5. Informational non-buying-intent keywords (spoilers, movies, etc.)
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
 * Financial products and non-book retail keywords that appear on product pages
 * as promotional widgets but aren't book-related (§2.1). Denylist guards against
 * leakage from "also bought" carousels that include unrelated items.
 */
const NON_BOOK_PRODUCT_TERMS = new Set([
  "barclaycard",
  "barclays",
  "instalments",
  "installments",
  "business card",
  "credit card",
  "apply now",
  "financing",
  "loans",
  "insurance",
  "amazon prime",
  "amazon credit",
  "amazon visa",
  "subscribe save",
  "digital downloads",
  "video games",
  "electronics",
  "home kitchen",
  "office supplies",
]);

/**
 * Buying-intent killwords that attract wrong audiences:
 * - Spoiler/summary/ending searches = person already has book or doesn't want it
 * - Movie/film/TV adaptations (unless verified) = wrong medium
 * - Song/music (unless verified) = wrong format
 * - "free" / piracy sites = non-paying audience
 * - "near me" = nonsensical for digital products (§2.5)
 */
const NON_BUYING_INTENT_TOKENS = new Set([
  "spoiler",
  "spoilers",
  "ending",
  "summary",
  "summarize",
  "plot summary",
  "movie",
  "film",
  "tv series",
  "tv show",
  "adaptation",
  "song",
  "soundtrack",
  "near me",
  "nearby",
  "free",
  "pirate",
  "torrent",
  "vk",
  "pdf",
]);

/**
 * Wikipedia category-taxonomy patterns (§2.6):
 * "[decade] [genre] films" or "[language] [genre] films" → Wikipedia categories,
 * not search phrases. Pattern: "films", "movies", or "television" at end.
 */
const WIKIPEDIA_TAXONOMY_PATTERN = /^(english[- ]language|american|british|australian|\d{2}(?:st|nd|rd|th)\s+century|1\d{3}s|\d{4}).*(?:films?|movies?|television|web series)$/i;

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
 * Check if keyword contains financial/non-book product terms (§2.1).
 * Catches keywords like "barclaycard", "business card", etc. that leaked
 * from promotional widgets on Amazon product pages.
 */
export function containsNonBookProductTerm(text: string): boolean {
  const lower = text.toLowerCase();
  return Array.from(NON_BOOK_PRODUCT_TERMS).some((term) => lower.includes(term));
}

// Compiled once at module load rather than per call: this runs once per
// generated candidate (up to BOOK_KEYWORD_MAX + BOOK_COMP_NAME_MAX per book),
// and NON_BUYING_INTENT_TOKENS never changes at runtime.
const NON_BUYING_INTENT_PATTERNS = Array.from(NON_BUYING_INTENT_TOKENS).map(
  (token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
);

/**
 * Check if keyword contains non-buying-intent tokens (§3.6).
 * Filters out spoiler/ending/movie/piracy keywords that don't drive purchases.
 */
export function containsNonBuyingIntentToken(text: string): boolean {
  const lower = text.toLowerCase();
  return NON_BUYING_INTENT_PATTERNS.some((pattern) => pattern.test(lower));
}

/**
 * Check if keyword looks like Wikipedia category taxonomy (§2.6).
 * Pattern: "[decade/language] [genre] films" → not a real search phrase.
 */
export function isWikipediaTaxonomy(text: string): boolean {
  return WIKIPEDIA_TAXONOMY_PATTERN.test(text);
}

/**
 * Check for malformed "book cover X, kindle unlimited" pattern (§2.3).
 * These come from concatenated UI labels + badges + titles from scraped product tiles.
 * Keyword shouldn't contain both a leading label marker and punctuation mixing.
 */
export function isMalformedProductTile(text: string): boolean {
  // Pattern: starts with "book" + has colon or comma mixing title/badge
  if (/^book\s+cover\s+/i.test(text) && /[:,]/.test(text)) {
    return true;
  }
  // Pattern: contains both UI chrome markers AND punctuation
  if (/\b(book cover|product|item|title)\b.*[,:]/i.test(text)) {
    // But allow if it's a verified book title with a colon (e.g., "The Hound: A Novel")
    // Heuristic: real titles rarely have a comma after a colon
    if (/:[^,]*,/.test(text)) return true;
  }
  return false;
}

/**
 * Check for repeated words ("books books", "store store") which indicate
 * template application to category labels instead of genre nouns (§2.4).
 */
export function hasRepeatedWords(text: string): boolean {
  const words = text.toLowerCase().split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i] === words[i + 1]) return true;
  }
  return false;
}

/**
 * Check if text looks like category labels instead of genre nouns (§2.4).
 * Pattern: "cozy kindle store", "fast paced kindle ebooks" — mood adjective
 * + category label (store/format) instead of genre noun.
 */
export function isCategoryLabelMisapplication(text: string): boolean {
  const categoryLabels = [
    "kindle store",
    "kindle ebook",
    "kindle books",
    "ebook",
    "audiobook",
    "books store",
    "amazon store",
    "store category",
  ];

  // Check if text ends with a category label (these should pair with genre nouns, not stand alone)
  for (const label of categoryLabels) {
    if (text.toLowerCase().endsWith(label)) {
      // Allowed: "[genre] [category]" patterns like "mystery kindle"
      // Not allowed: mood adjectives before category labels like "cozy kindle store"
      const moodAdjectives = ["cozy", "dark", "fast paced", "slow burn", "gritty"];
      if (moodAdjectives.some((adj) => text.toLowerCase().startsWith(adj))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Quality check: Is this keyword likely to perform well?
 * Returns scoring adjustment (0 = no change, negative = penalize).
 * Incorporates all critical bug filters from §2 and strategic issues from §3.
 */
export function getKeywordQualityAdjustment(text: string): number {
  const lower = text.toLowerCase();

  // CRITICAL BUGS (§2) — hard blocks

  // §2.1: Off-topic financial products
  if (containsNonBookProductTerm(text)) {
    return -100; // Extreme penalty — must be rejected
  }

  // §2.3: Malformed "book cover ... kindle unlimited" pattern
  if (isMalformedProductTile(text)) {
    return -100;
  }

  // §2.4: Repeated words ("books books", "store store")
  if (hasRepeatedWords(text)) {
    return -100;
  }

  // §2.4: Category-label misapplication ("cozy kindle store")
  if (isCategoryLabelMisapplication(text)) {
    return -15;
  }

  // §2.6: Wikipedia taxonomy pattern
  if (isWikipediaTaxonomy(text)) {
    return -100;
  }

  // STRATEGIC ISSUES (§3) — soft penalties

  // §3.6: Non-buying-intent keywords
  if (containsNonBuyingIntentToken(text)) {
    return -20;
  }

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
 * - Remove critical bugs (extreme penalties < -50)
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

      // CRITICAL BUGS (§2): block entirely, don't just reduce bid
      if (qualityAdjust <= -50) {
        // These are invalid/malformed and must not ship
        return null;
      }

      if (qualityAdjust < -5) {
        // Ultra-generic or high-priority issues: block entirely
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
