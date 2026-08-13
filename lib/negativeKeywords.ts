/**
 * Negative keyword candidates.
 *
 * Rejecting a keyword stops the app bidding on it. It does not stop Amazon
 * *serving* on it: a Broad-match "scottish crime books" will still match
 * "scottish fold cat books" if Amazon thinks the two are related, and an
 * auto campaign will find it on its own. The terms the filter pipeline just
 * rejected are therefore the best-evidenced negative list available — they
 * were derived from this book's own vocabulary and judged irrelevant to it.
 *
 * Only the rejections that describe a *search intent* become negatives.
 * Scrape artifacts ("264 pages") and phrasing problems ("fast paced
 * scottish") are the generator's fault, not a reader's query, and adding
 * them as negatives would waste the ad group's negative slots.
 */

import { normalizeKeyword } from "./keywordFilters";
import type { FilteredKeyword } from "./keywordFilters";
import type { MatchType } from "./types";

/**
 * Filters whose rejections represent a real, unwanted search intent — the
 * reader who typed this wants something the book is not.
 */
const INTENT_FILTERS = new Set([
  "offTopicEntity",
  "languageMarket",
  "formatAvailability",
  // Brief §5.10 bonus: high-volume drops (PRODUCT, GIFT_INTENT, BOILERPLATE,
  // TITLE_COLLISION) are strong, well-evidenced negatives — a reader who
  // typed one of these wants a mug or a Warcraft quest, not this book.
  "physicalProduct",
  "bookIntentGate",
  "marketplaceBoilerplate",
  "titleCollision",
]);

export interface NegativeKeyword {
  text: string;
  /** Negative exact for a specific unwanted query, negative phrase for a whole family of them. */
  matchType: Extract<MatchType, "phrase" | "exact">;
  reason: string;
  /**
   * `campaign` (blocks the term across every ad group in that campaign) or
   * `ad_group` (blocks it only where attached) — see campaigns spec §1.3.
   * This module stays campaign-unaware and never sets it; it defaults to
   * `ad_group` at the bulksheet layer (lib/bulksheet.ts,
   * lib/bulksheetUpload.ts), which is where starter-list junk terms like the
   * ones this file produces belong. Campaign-scoped negatives (e.g. the
   * future Alpha Exact → BMM Discovery safeguard) are set explicitly by
   * whatever assembles that specific negative, not by this file.
   */
  scope?: "campaign" | "ad_group";
}

/** Terms so broad that negating them as a phrase would suppress wanted traffic too. */
const MIN_PHRASE_WORDS = 2;

/**
 * Amazon's own length limits on negative keywords: a negative phrase may be
 * at most 4 words, a negative exact at most 10. A row over its limit is
 * rejected at upload, so emitting one doesn't just lose that negative — it
 * puts an error row in the middle of the user's bulksheet.
 *
 * These bite in practice because negatives are built from *rejected*
 * keywords, and the sources that produce the longest candidates are exactly
 * the ones whose rejections make the best negatives: autocomplete drift off
 * the title ("scars of the past world of warcraft quest walkthrough") is a
 * title collision, and it is nine words long.
 */
export const NEGATIVE_PHRASE_MAX_WORDS = 4;
export const NEGATIVE_EXACT_MAX_WORDS = 10;

/**
 * The widest negative match type Amazon will accept for `text`, starting
 * from the one the caller wants, or `undefined` when the term is too long
 * to express as either.
 *
 * A phrase negative that's over its 4-word limit is narrowed to exact rather
 * than dropped: exact only blocks that one literal query instead of the
 * whole family, but a long-tail drift term is close to a single query
 * anyway, and a narrower negative beats an invalid row.
 */
export function fitNegativeMatchType(
  text: string,
  preferred: NegativeKeyword["matchType"]
): NegativeKeyword["matchType"] | undefined {
  const wordCount = text.split(" ").filter(Boolean).length;
  if (preferred === "phrase" && wordCount <= NEGATIVE_PHRASE_MAX_WORDS) return "phrase";
  if (wordCount <= NEGATIVE_EXACT_MAX_WORDS) return "exact";
  return undefined;
}

/**
 * Turns pipeline rejections into a negative keyword list. Multi-word
 * rejections become negative *phrase* (one entry kills the whole family:
 * "fold cat" covers "scottish fold cat books"); single words stay exact,
 * where they can only match themselves. Both are then held to Amazon's
 * word-count limits above.
 */
export function buildNegativeKeywords(results: FilteredKeyword[], limit = 60): NegativeKeyword[] {
  const byText = new Map<string, NegativeKeyword>();

  for (const result of results) {
    if (result.verdict !== "reject" || !result.filter) continue;
    if (!INTENT_FILTERS.has(result.filter)) continue;

    const text = normalizeKeyword(result.text);
    if (!text || byText.has(text)) continue;

    const preferred = text.split(" ").length >= MIN_PHRASE_WORDS ? "phrase" : "exact";
    const matchType = fitNegativeMatchType(text, preferred);
    // Too long for even a negative exact: no way to express it, so it's
    // dropped rather than shipped as a row Amazon will reject.
    if (!matchType) continue;

    byText.set(text, { text, matchType, reason: result.reason ?? result.filter });
  }

  return Array.from(byText.values()).slice(0, limit);
}

/**
 * Negatives for formats the listing doesn't have. These aren't drawn from a
 * rejection — nobody has to generate "hardcover" for a Kindle-only book to
 * be shown on it — so they're derived directly from the format data.
 */
export function buildFormatNegatives(availableFormats: string[]): NegativeKeyword[] {
  const missing = ["hardcover", "paperback", "audiobook", "large print"].filter(
    (format) => !availableFormats.includes(format)
  );
  return missing.map((format) => ({
    text: format,
    matchType: "phrase" as const,
    reason: `no ${format} edition on this listing`,
  }));
}
