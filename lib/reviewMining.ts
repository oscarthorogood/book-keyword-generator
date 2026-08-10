import { isGarbledText, isScrapedBoilerplate } from "./keywordMerge";
import { KeywordCandidate } from "./types";

/**
 * "Review & Blurb Language Mining" (manual research blueprint, section 4):
 * authors describe their books differently than readers search for them, so
 * recurring phrases across review text ("slow burn", "locked room mystery")
 * are a free signal for reader vocabulary. This automates the 5-star half of
 * that — frequency-counting recurring 2-4 word phrases across the review
 * excerpts already embedded on the product page (see extractReviewSnippets
 * in lib/scrape.ts).
 *
 * The blueprint's 3-star "gap analysis" ("I was hoping for more X") isn't
 * attempted here — that requires reading the star rating per review and
 * genuinely understanding what's missing, not just counting phrases, and
 * would need a second scrape of the paginated/filtered review page. Left as
 * a manual step.
 */

// Word-level stopwords for filtering n-grams, distinct from
// GENERIC_STANDALONE_TERMS in keywordMerge.ts (which filters whole
// candidate phrases, not individual gram-boundary words).
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "is", "was", "were", "are", "be", "been", "being",
  "this", "that", "these", "those", "it", "its", "i", "me", "my", "you", "your", "he", "she",
  "they", "we", "to", "of", "in", "on", "for", "with", "as", "at", "by", "so", "if", "than",
  "not", "no", "do", "did", "does", "have", "has", "had", "just", "very", "really", "also",
  "book", "books", "read", "reading", "story", "novel",
]);

const MIN_SNIPPET_LENGTH = 15;
// Phrases with 2+ occurrences are definitely valuable; single occurrences are
// kept if they're high-quality (specific multi-word phrases, not generic terms)
const MIN_GRAM_OCCURRENCES = 1;
const MIN_GRAM_OCCURRENCES_FOR_SINGLE_WORD = 3; // Single words need more evidence
const MAX_MINED_PHRASES = 30; // Increased from 20 to capture more variety

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function extractNgrams(tokens: string[], n: number): string[] {
  const grams: string[] = [];
  for (let i = 0; i <= tokens.length - n; i++) {
    const gram = tokens.slice(i, i + n);
    // Anchoring on a stopword at either edge tends to produce fragments
    // ("this book was", "and the plot") rather than the noun/adjective
    // phrases the blueprint is after ("slow burn", "grumpy sunshine").
    if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[gram.length - 1])) continue;
    grams.push(gram.join(" "));
  }
  return grams;
}

/** Mines recurring 2-4 word phrases out of review excerpt text. Returns candidates tagged "review-language". */
export function mineReviewLanguage(snippets: string[]): KeywordCandidate[] {
  const counts = new Map<string, number>();
  const wordCounts = new Map<string, number>(); // Track word count per phrase

  for (const snippet of snippets) {
    if (snippet.length < MIN_SNIPPET_LENGTH) continue;
    const tokens = tokenize(snippet);
    for (const n of [2, 3, 4]) {
      for (const gram of extractNgrams(tokens, n)) {
        if (isGarbledText(gram) || isScrapedBoilerplate(gram)) continue;
        counts.set(gram, (counts.get(gram) ?? 0) + 1);
        wordCounts.set(gram, n);
      }
    }
  }

  const candidates = Array.from(counts.entries())
    .filter(([gram, count]) => {
      const words = wordCounts.get(gram) ?? 2;
      // Multi-word phrases (3-4 words) are kept with 1+ occurrences
      // 2-word phrases need 2+ occurrences to avoid noise
      return words >= 3 || count >= MIN_GRAM_OCCURRENCES_FOR_SINGLE_WORD;
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_MINED_PHRASES)
    .map(([text]) => ({ text, sources: ["review-language" as const] }));

  // If we only found a few phrases, lower the threshold and try again with 2-word phrases
  if (candidates.length < 5 && counts.size > 0) {
    const moreCandidates = Array.from(counts.entries())
      .filter(([gram, count]) => {
        const words = wordCounts.get(gram) ?? 2;
        // Allow single-occurrence 2-word phrases if we don't have enough results
        return words === 2 && count >= 1;
      })
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([text]) => ({ text, sources: ["review-language" as const] }));

    // Merge, removing duplicates
    const existingTexts = new Set(candidates.map(c => c.text));
    for (const candidate of moreCandidates) {
      if (!existingTexts.has(candidate.text) && candidates.length < MAX_MINED_PHRASES) {
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}
