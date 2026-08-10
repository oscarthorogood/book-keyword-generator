/**
 * Field-weighted n-gram mining over a listing record.
 *
 * The rest of the pipeline treats each source as a bag of phrases and scores
 * a candidate by how many sources agree on it. That misses something the
 * page itself tells you: *where* on the listing a phrase appeared. A phrase
 * in the product title is the densest keyword signal Amazon gives you; the
 * same phrase buried in the blurb is a passing mention. This module scores
 * n-grams by frequency × the weight of the field they came from, exactly as
 * the metadata spec lays out.
 *
 * Weights (spec §4.2): title 3.0, meta keywords 2.5, bullets 2.0, URL slug
 * 2.0, reviews 1.5, description 1.0.
 */

import { isUsableKeyword, normalize } from "./keywordMerge";
import type { ListingRecord } from "./listingRecord";
import type { KeywordCandidate, KeywordSource } from "./types";

export const FIELD_WEIGHTS = {
  title: 3.0,
  metaKeywords: 2.5,
  bullets: 2.0,
  urlSlug: 2.0,
  htmlTitle: 2.0,
  reviews: 1.5,
  description: 1.0,
  variations: 1.0,
} as const;

/**
 * Tokenisation stopwords. Deliberately small: this is n-gram *boundary*
 * hygiene, not topic filtering — the relevance decisions all happen later in
 * the filter pipeline.
 */
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "in", "on", "at", "to", "for",
  "with", "by", "from", "as", "is", "was", "are", "were", "be", "been", "it",
  "its", "this", "that", "these", "those", "his", "her", "their", "he", "she",
  "they", "you", "your", "we", "our", "i", "my", "me", "him", "them", "not",
  "no", "so", "if", "than", "then", "there", "when", "will", "can", "all",
  "new", "more", "most", "very", "just", "also", "one", "two", "out", "up",
]);

const MIN_TOKEN_LENGTH = 2;
const MAX_NGRAM = 4;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);
}

/**
 * 1-4 word n-grams with stopwords stripped from the edges. A gram that
 * starts or ends on a stopword is a sentence fragment ("of the past"), not a
 * phrase anyone searches.
 */
function ngrams(tokens: string[]): string[] {
  const grams: string[] = [];
  for (let n = 1; n <= MAX_NGRAM; n += 1) {
    for (let i = 0; i + n <= tokens.length; i += 1) {
      const gram = tokens.slice(i, i + n);
      if (STOPWORDS.has(gram[0]) || STOPWORDS.has(gram[gram.length - 1])) continue;
      if (gram.every((token) => STOPWORDS.has(token))) continue;
      grams.push(gram.join(" "));
    }
  }
  return grams;
}

interface WeightedField {
  text: string;
  weight: number;
}

function fieldsOf(record: ListingRecord): WeightedField[] {
  const fields: WeightedField[] = [];
  const push = (text: string | undefined, weight: number) => {
    if (text && text.trim()) fields.push({ text, weight });
  };

  push(record.title, FIELD_WEIGHTS.title);
  push(record.htmlTitle, FIELD_WEIGHTS.htmlTitle);
  push(record.metaKeywords.join(", "), FIELD_WEIGHTS.metaKeywords);
  push(record.bullets.join(". "), FIELD_WEIGHTS.bullets);
  push(record.urlSlug, FIELD_WEIGHTS.urlSlug);
  push(record.reviewSnippets.join(". "), FIELD_WEIGHTS.reviews);
  push(record.description, FIELD_WEIGHTS.description);
  push(record.variations.join(", "), FIELD_WEIGHTS.variations);

  return fields;
}

export interface ListingNgram {
  text: string;
  /** Σ (occurrences in field × field weight). */
  weight: number;
  /** Which fields contributed, best-weighted first. */
  fields: string[];
}

/** Scores every n-gram across the record's fields, highest weight first. */
export function scoreListingNgrams(record: ListingRecord): ListingNgram[] {
  const scores = new Map<string, ListingNgram>();

  for (const field of fieldsOf(record)) {
    const label = Object.entries(FIELD_WEIGHTS).find(([, weight]) => weight === field.weight)?.[0] ?? "field";
    for (const gram of ngrams(tokenize(field.text))) {
      const existing = scores.get(gram);
      if (existing) {
        existing.weight += field.weight;
        if (!existing.fields.includes(label)) existing.fields.push(label);
      } else {
        scores.set(gram, { text: gram, weight: field.weight, fields: [label] });
      }
    }
  }

  return Array.from(scores.values()).sort((a, b) => b.weight - a.weight);
}

/**
 * The listing's own HTML metadata as keyword candidates: Amazon's meta
 * keywords, the `<title>` tag, the canonical URL slug and the variation
 * swatches, plus the best-weighted n-grams across all of it.
 *
 * Emitted under the "listing-metadata" source so the filter pipeline and the
 * keyword manager can tell them apart from the on-page copy — these are the
 * terms Amazon itself associates with the listing.
 */
export function buildListingMetadataCandidates(
  record: ListingRecord,
  options: { maxNgrams?: number; minWeight?: number } = {}
): KeywordCandidate[] {
  const { maxNgrams = 40, minWeight = 2.0 } = options;
  const source: KeywordSource = "listing-metadata";
  const texts = new Map<string, number>();

  const consider = (raw: string | undefined, weight: number) => {
    if (!raw) return;
    const normalized = normalize(raw);
    if (!isUsableKeyword(normalized)) return;
    texts.set(normalized, Math.max(texts.get(normalized) ?? 0, weight));
  };

  for (const keyword of record.metaKeywords) consider(keyword, FIELD_WEIGHTS.metaKeywords);
  consider(record.urlSlug, FIELD_WEIGHTS.urlSlug);
  for (const variation of record.variations) consider(variation, FIELD_WEIGHTS.variations);

  for (const gram of scoreListingNgrams(record)) {
    if (texts.size >= maxNgrams) break;
    if (gram.weight < minWeight) break; // sorted, so nothing after this qualifies either
    // Single tokens carry almost no intent on their own and the single-word
    // filter would drop them anyway; skip the round trip.
    if (gram.text.split(" ").length < 2) continue;
    consider(gram.text, gram.weight);
  }

  return Array.from(texts.entries()).map(([text, weight]) => ({
    text,
    sources: [source],
    score: weight,
  }));
}
