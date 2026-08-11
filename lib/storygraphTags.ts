/**
 * StoryGraph mood/pace tags (spec §5) — accepts pre-fetched raw tag strings
 * for an ISBN/ASIN (StoryGraph has no public API and is scrape-adjacent, so
 * live fetching is deliberately out of scope here, matching how
 * lib/goodreads.ts is the only module in this codebase that actually
 * scrapes a third-party book site). Tags are templated with the book's
 * genre into mood-tone phrases readers actually search.
 */

import { normalize } from "./keywordMerge";
import { KeywordCandidate } from "./types";

/**
 * Builds mood-tone candidates from StoryGraph tags ("dark", "fast-paced",
 * "mysterious") crossed with the book's genre ("dark police procedurals",
 * "fast-paced crime thriller").
 */
export function buildStorygraphTagsCandidates(
  book: { genre?: string },
  tags: string[]
): KeywordCandidate[] {
  const genre = book.genre?.trim();
  const texts = new Set<string>();

  for (const rawTag of tags) {
    const tag = normalize(rawTag.replace(/-/g, " "));
    if (!tag || tag.length < 3) continue;

    texts.add(tag);
    if (genre) {
      texts.add(normalize(`${tag} ${genre}`));
    }
  }

  return Array.from(texts).map((text) => {
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const candidate: KeywordCandidate = {
      text,
      sources: ["storygraph-tags"],
      category: "mood-tone",
      intentSegment: "mood-setting",
      specificity: wordCount >= 3 ? 4 : 3,
    };
    return candidate;
  });
}
