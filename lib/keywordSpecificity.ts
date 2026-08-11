/**
 * Keyword specificity: a 1 (Broad) – 5 (Very specific) rating shown as a
 * column in the keyword manager (Enhancements spec §1).
 *
 * Computed at generation time from signals the pipeline already has —
 * word count, anchor hits (lib/keywordAnchors.ts), semantic category
 * (lib/keywordCategories.ts) and generic book-intent tokens — so it stays
 * consistent with lib/keywordMerge.ts#pickMatchType: an exact-match comp
 * name should almost never come out "broad".
 */

import type { BookAnchors } from "./keywordAnchors";
import type { KeywordCandidate, KeywordCategory } from "./types";

export type Specificity = 1 | 2 | 3 | 4 | 5;

export const SPECIFICITY_LABELS: Record<Specificity, string> = {
  1: "Broad",
  2: "Somewhat broad",
  3: "Medium",
  4: "Somewhat specific",
  5: "Very specific",
};

/** Sources that identify a named comparable title/author — inherently specific. */
const COMP_NAME_SOURCES = new Set(["comp-name", "amazon-recs", "comp-title", "author-catalog"]);

/** Categories that name a specific comparable — inherently specific regardless of length. */
const INHERENTLY_SPECIFIC_CATEGORIES = new Set<KeywordCategory>([
  "competing-authors",
  "comp-titles",
  "series-names",
]);

/** Bare genre/mood labels read as broad even when paired with a modifier. */
const INHERENTLY_BROAD_CATEGORIES = new Set<KeywordCategory>(["core-genre", "mood-tone", "format"]);

function wordCountBase(wordCount: number): Specificity {
  if (wordCount >= 5) return 4;
  if (wordCount >= 3) return 3;
  return 2;
}

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

function containsAnyOf(text: string, terms: string[]): boolean {
  return terms.some((term) => term && text.includes(term.toLowerCase()));
}

/**
 * Scores one candidate's specificity (1–5). `anchors` is the same
 * per-book anchor set the filter pipeline uses, so a hit against
 * `bookSpecific` (title/author/series/character names) or `comps`
 * (comparable authors/titles) pushes the score up rather than relying on
 * word count alone.
 */
export function scoreSpecificity(candidate: KeywordCandidate, anchors: BookAnchors): Specificity {
  const text = normalize(candidate.text);
  const wordCount = candidate.text.trim().split(/\s+/).filter(Boolean).length;

  let score: number = wordCountBase(wordCount);

  const isCompNamed =
    candidate.sources.some((source) => COMP_NAME_SOURCES.has(source)) ||
    (candidate.category && INHERENTLY_SPECIFIC_CATEGORIES.has(candidate.category)) ||
    containsAnyOf(text, anchors.comps);

  if (isCompNamed) {
    // Consistent with pickMatchType: comp names run Exact and should read
    // as specific even when short ("gone girl" is 2 words but names a book).
    score = Math.max(score, 4);
  }

  if (containsAnyOf(text, anchors.bookSpecific)) {
    score += 1;
  }

  if (candidate.category && INHERENTLY_BROAD_CATEGORIES.has(candidate.category) && !isCompNamed) {
    score -= 1;
  }

  // Generic book-intent words ("books", "kindle", "read") on their own —
  // not paired with anything above — read as broad regardless of length.
  const isBookIntentOnly =
    wordCount <= 2 && anchors.bookIntent.some((token) => text === normalize(token) || text.endsWith(` ${normalize(token)}`));
  if (isBookIntentOnly && !isCompNamed) {
    score = Math.min(score, 2);
  }

  return Math.max(1, Math.min(5, Math.round(score))) as Specificity;
}
