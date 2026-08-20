/**
 * Competitor-ASIN specificity: the keyword-side "closest match to book"
 * rating (lib/keywordSpecificity.ts), extended to competitor ASINs
 * (competitor_asins.specificity, sql/29-competitor-asin-specificity.sql).
 *
 * Keywords are scored against this book's anchors (title/author/series,
 * genre, comps) because a keyword *is* a search phrase. A competitor ASIN
 * has no phrase to score — what it has instead is the metadata captured at
 * discovery time (competitor_asins.title/author, sql/17-competitor-asin-metadata.sql).
 * So "closest match to book" here means: does this ASIN's title/author line
 * up with the comparable authors/titles this book's own generation pipeline
 * already recognises (anchors.comps), or at least share genre/setting
 * vocabulary with it? An ASIN discovered off a genre/autocomplete query with
 * no name overlap at all is a much weaker match than one that names a comp
 * this book was built against.
 *
 * Same 1 (Broad) – 5 (Very specific) scale and labels as keywords — see
 * SPECIFICITY_LABELS in lib/keywordSpecificity.ts, reused rather than
 * duplicated here.
 */

import { coreTitle, type BookAnchors } from "./keywordAnchors";
import type { Specificity } from "./keywordSpecificity";

export interface AsinMetadataForSpecificity {
  title?: string | null;
  author?: string | null;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Loose containment either way — a stored comp anchor is often just a
 * surname or short title. Both sides need the length floor: without it, a
 * short value like "kin" would match `anchor.includes(value)` against any
 * anchor that merely contains that substring (e.g. "ian rankin"), producing
 * a false comp match.
 */
function overlapsAnyOf(value: string, anchors: string[]): string | undefined {
  if (value.length < 4) return undefined;
  return anchors.find((anchor) => anchor.length >= 4 && (value.includes(anchor) || anchor.includes(value)));
}

/**
 * Scores one competitor ASIN's specificity (1–5) from its captured
 * title/author against `anchors`, the same per-book anchor set the keyword
 * filter pipeline uses. Returns null when the ASIN has no title or author to
 * score against at all — e.g. a manually-added ASIN before its metadata
 * fetch has run — mirroring how negatives aren't scored on the keyword side.
 */
export function scoreAsinSpecificity(asin: AsinMetadataForSpecificity, anchors: BookAnchors): Specificity | null {
  const title = asin.title?.trim() || undefined;
  const author = asin.author?.trim() || undefined;
  if (!title && !author) return null;

  // Baseline: having both fields is a stronger starting point than a lone
  // title or author scraped off a thin discovery source.
  let score: number = title && author ? 3 : 2;

  const authorNorm = author ? normalize(author) : undefined;
  const authorIsComp = authorNorm ? !!overlapsAnyOf(authorNorm, anchors.comps) : false;

  const titleCore = title ? coreTitle(title) : undefined;
  const titleIsComp = titleCore ? !!overlapsAnyOf(titleCore, anchors.comps) : false;

  if (authorIsComp && titleIsComp) {
    // Both the author and the title line up with a comp this book's own
    // pipeline already tracks — as close a match as an ASIN gets.
    score = 5;
  } else if (authorIsComp || titleIsComp) {
    score = Math.max(score, 4);
  } else {
    // No named-comp overlap — fall back to whether the title/author text at
    // least shares this book's genre or setting vocabulary.
    const combined = `${title ?? ""} ${author ?? ""}`.toLowerCase();
    const genreHit = anchors.genre.some((term) => term.length >= 3 && combined.includes(term));
    const settingHit = anchors.setting.some((term) => term.length >= 3 && combined.includes(term));
    if (genreHit || settingHit) {
      score = Math.max(score, 3);
    } else {
      score = Math.min(score, 2);
    }
  }

  return Math.max(1, Math.min(5, score)) as Specificity;
}
