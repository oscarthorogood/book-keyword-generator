/**
 * Protect against author/entity name hallucinations when comp data is thin (§2.5 from audit).
 *
 * Problem: When the system can't find real comp titles/authors for a book (e.g., indie
 * author "A. A. Warren" with only 1 comp found), it fills the gap with generated guesses
 * that look close to the author's name. These produce keywords like:
 * - "a.a. fair books in order" (Erle Stanley Gardner's pen name — real, unrelated person)
 * - "warner books publisher" (real, unrelated imprint)
 * - "werner books erie pa" (real, unrelated bookstore)
 * - "black talon books" (Winchester ammunition brand)
 * - "aa books near me" (Alcoholics Anonymous literature)
 *
 * These aren't obvi ously wrong — they're real trademarks/orgs that happen to be close
 * to the author's name. But they're still hallucinations that will waste ad spend.
 *
 * Solution: When comp data is too thin (< 3 real comps found), don't backfill with
 * generated author/publisher guesses. Ship a shorter list and flag for manual review.
 */

import { RelatedCompetitor } from "./types";

// Minimum confidence thresholds
const MIN_REAL_COMPS_TO_BACKFILL = 3;

export interface CompDataHealthStatus {
  hasEnoughData: boolean;
  realCompCount: number;
  minRequired: number;
  recommendation: string;
}

/**
 * Assess health of comp data. Returns whether the system should trust it
 * enough to backfill with generated author/publisher/series names.
 *
 * Heuristic:
 * - 3+ real comps: backfill safe, book has enough visible competition
 * - 1-2 real comps: don't backfill, risk of hallucinations
 * - 0 real comps: definitely don't backfill, use manual keywords only
 */
export function assessCompDataHealth(
  competitors: RelatedCompetitor[]
): CompDataHealthStatus {
  // Count only genuine comp titles (title + author, not just title or author alone)
  const realComps = competitors.filter((c) => c.title && c.author).length;

  return {
    hasEnoughData: realComps >= MIN_REAL_COMPS_TO_BACKFILL,
    realCompCount: realComps,
    minRequired: MIN_REAL_COMPS_TO_BACKFILL,
    recommendation:
      realComps >= MIN_REAL_COMPS_TO_BACKFILL
        ? "Comp data sufficient for backfill"
        : `Only ${realComps} real comps found (need ${MIN_REAL_COMPS_TO_BACKFILL}). ` +
          "Don't backfill with generated author/publisher guesses — risk of hallucinations. " +
          "Use manual keywords only, flag for manual review.",
  };
}

/**
 * List of known real publishers, series, and author names that might look similar
 * to user-provided names but are actually unrelated entities. Used to detect
 * potential hallucinations in generated keywords.
 *
 * If generated keyword matches these, it's probably a hallucination filling a gap.
 */
const KNOWN_UNRELATED_ENTITIES = new Set([
  // Real authors with similar names
  "a.a. fair", // Erle Stanley Gardner pen name
  "warner books", // Publishing imprint
  "werner books", // Bookstore name
  "black talon", // Ammunition brand
  "aa books", // Alcoholics Anonymous

  // Common publisher imprints
  "random house",
  "penguin books",
  "harper collins",
  "simon schuster",
  "macmillan",
  "scholastic",
  "hachette",

  // Common series names
  "perry mason",
  "nancy drew",
  "sherlock holmes",
  "james bond",
  "miss marple",

  // Geographic indicators (nonsensical for ebooks)
  "erie pa",
  "new york",
  "london",
  "publisher",
  "bookstore",
  "library",
  "near me",
  "local",
]);

/**
 * Check if a generated keyword looks like it might be a hallucination — a
 * real entity (imprint, unrelated author, bookshop, brand) that got pulled in
 * to fill a gap rather than because it describes this book.
 *
 * This is a heuristic: substring match against known unrelated entities, plus
 * an abbreviation-density check on name-shaped templates. Used as a second
 * line of defense when comp data is thin.
 */
export function mightBeHallucination(generatedKeyword: string): boolean {
  const lower = generatedKeyword.toLowerCase().trim();

  // Check if it matches a known unrelated entity
  for (const entity of KNOWN_UNRELATED_ENTITIES) {
    if (lower.includes(entity)) {
      return true;
    }
  }

  // Check if it's generated from author name but doesn't make sense
  // (e.g., "aa warren books" from author "A. A. Warren" — valid,
  // but "a.a. fair books" where "A. A. Fair" is someone else — hallucination)
  if (lower.includes("books in order") || lower.includes("books publisher")) {
    // These templates are safe when derived from real comps, risky when generating
    // Lightweight heuristic: if more than 30% of the keyword is punctuation or
    // abbreviations, it probably came from a poorly-matched author name
    const abbrevCount = (lower.match(/[.]/g) ?? []).length;
    if (abbrevCount > 2) {
      return true;
    }
  }

  return false;
}

/**
 * Filter out potentially hallucinated keywords when comp data is thin.
 * Applied after scoring, before final selection, when hasEnoughData = false.
 */
export function filterHallucinatedCompKeywords<T extends { text: string }>(
  keywords: T[],
  compDataHealth: CompDataHealthStatus
): T[] {
  if (compDataHealth.hasEnoughData) {
    // Enough real data — comparable names are backed by actual competitors
    return keywords;
  }

  // Thin comp data — drop the suspicious names rather than bid on them
  return keywords.filter((keyword) => !mightBeHallucination(keyword.text));
}
