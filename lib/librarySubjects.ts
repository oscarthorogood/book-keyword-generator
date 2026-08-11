/**
 * Library-of-Congress / library catalogue subject headings (spec §5) —
 * accepts pre-fetched raw subject strings for an ISBN/ASIN, same simple
 * "caller supplies the raw data" shape as lib/storygraphTags.ts. LCSH
 * strings often chain subdivisions with " -- " (see buildLocCandidates in
 * lib/keywordMerge.ts for the existing precedent), so those are split the
 * same way here.
 */

import { normalize } from "./keywordMerge";
import { KeywordCandidate } from "./types";

/**
 * Builds genre-metadata candidates from library subject headings, splitting
 * chained LCSH subdivisions and templating with the book's genre where that
 * produces a cleaner search phrase.
 */
export function buildLibrarySubjectsCandidates(
  book: { genre?: string },
  subjects: string[]
): KeywordCandidate[] {
  const genre = book.genre?.trim();
  const texts = new Set<string>();

  for (const raw of subjects) {
    for (const piece of raw.split(/--/)) {
      const subject = normalize(piece);
      if (!subject || subject.length < 3) continue;
      texts.add(subject);
      if (genre && !subject.includes(genre.toLowerCase())) {
        texts.add(normalize(`${subject} ${genre}`));
      }
    }
  }

  return Array.from(texts).map((text) => {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const candidate: KeywordCandidate = {
      text,
      sources: ["library-subjects"],
      category: "sub-genre",
      intentSegment: "genre-core",
      specificity: wordCount >= 3 ? 4 : 3,
    };
    return candidate;
  });
}
