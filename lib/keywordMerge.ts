import { BookMetadata, KeywordCandidate, KeywordSource, ProductPageData } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// Standalone terms too broad/generic to be worth a keyword slot on their own
// (they're fine as part of a longer phrase — "fantasy book" is kept, "book"
// alone is not). Filtering these out here means budget doesn't get split
// across near-worthless single-word broad matches.
const GENERIC_STANDALONE_TERMS = new Set([
  "book",
  "books",
  "novel",
  "novels",
  "fiction",
  "story",
  "stories",
  "read",
  "reading",
  "author",
  "authors",
  "paperback",
  "hardcover",
  "hardback",
  "kindle",
  "ebook",
  "bestseller",
  "bestsellers",
  "new",
  "series",
  "edition",
  "volume",
  "print",
  "gift",
  "gifts",
  "publisher",
  "published",
]);

function isUsableKeyword(text: string): boolean {
  if (text.length < 3 || text.length > 80) return false;
  // Drop noisy Open Library / Google Books subjects (URLs, ID-like tags, etc.)
  if (/https?:\/\//.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (GENERIC_STANDALONE_TERMS.has(text)) return false;
  return true;
}

/**
 * Splits combined category strings like "Fiction / Fantasy / Epic" or
 * "Fiction, Fantasy, Epic" into individual thematic keyword candidates.
 */
function splitCategoryString(raw: string): string[] {
  return raw
    .split(/\/|,|>/)
    .map((s) => normalize(s))
    .filter(isUsableKeyword);
}

export function buildCategoryCandidates(
  categories: string[],
  source: KeywordSource
): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const category of categories) {
    for (const piece of splitCategoryString(category)) texts.add(piece);
  }
  return Array.from(texts).map((text) => ({ text, sources: [source] }));
}

export function buildGenreMetadataCandidates(metadata: BookMetadata): KeywordCandidate[] {
  const categoryCandidates = buildCategoryCandidates(metadata.categories, "genre-metadata");

  const subjectTexts = new Set<string>();
  for (const subject of metadata.subjects) {
    const normalized = normalize(subject);
    if (isUsableKeyword(normalized)) subjectTexts.add(normalized);
  }
  const subjectCandidates = Array.from(subjectTexts).map((text) => ({
    text,
    sources: ["genre-metadata" as const],
  }));

  return mergeKeywordCandidates(categoryCandidates, subjectCandidates);
}

export function buildCompTitleCandidates(productPage: ProductPageData): KeywordCandidate[] {
  const titleTexts = new Set<string>();
  for (const title of productPage.compTitles) {
    const normalized = normalize(title);
    if (isUsableKeyword(normalized)) titleTexts.add(normalized);
  }
  const titleCandidates = Array.from(titleTexts).map((text) => ({
    text,
    sources: ["comp-title" as const],
  }));

  const categoryCandidates = buildCategoryCandidates(productPage.categories, "comp-title");
  return mergeKeywordCandidates(titleCandidates, categoryCandidates);
}

const BUYER_INTENT_GENRE_LIMIT = 6;

/**
 * Crosses the top genre/subject terms already extracted from metadata with
 * generic buyer-intent phrasing ("best X books", "X books for adults") to
 * generate long-tail candidates for free — no extra API calls, just
 * templating on data we already fetched.
 */
export function buildBuyerIntentCandidates(
  genreTerms: string[],
  title?: string
): KeywordCandidate[] {
  const texts = new Set<string>();

  for (const genre of genreTerms.slice(0, BUYER_INTENT_GENRE_LIMIT)) {
    texts.add(`best ${genre} books`);
    texts.add(`${genre} books`);
    texts.add(`${genre} novel`);
  }
  if (title) {
    texts.add(`books like ${title}`);
  }

  return Array.from(texts)
    .map((text) => normalize(text))
    .filter(isUsableKeyword)
    .map((text) => ({ text, sources: ["buyer-intent" as const] }));
}

/**
 * Merges keyword candidates from every source into one deduped list, tagged
 * with all sources that surfaced each term, keeping the first bid estimate
 * found (only the Ads API source currently supplies one).
 */
export function mergeKeywordCandidates(...groups: KeywordCandidate[][]): KeywordCandidate[] {
  const merged = new Map<string, KeywordCandidate>();

  for (const group of groups) {
    for (const candidate of group) {
      const text = normalize(candidate.text);
      if (!isUsableKeyword(text)) continue;

      const existing = merged.get(text);
      if (existing) {
        const sources = new Set([...existing.sources, ...candidate.sources]);
        existing.sources = Array.from(sources);
        existing.suggestedBid = existing.suggestedBid ?? candidate.suggestedBid;
      } else {
        merged.set(text, { ...candidate, text });
      }
    }
  }

  return Array.from(merged.values());
}

const SIGNATURE_STOPWORDS = new Set(["a", "an", "the", "of", "and", "or", "for"]);

/**
 * A word-order- and plural-insensitive signature used to catch near-dupes
 * that exact-text matching misses ("wizard school books" vs "wizard schools
 * book"), so they don't split budget across near-identical keyword slots.
 */
function dedupeSignature(text: string): string {
  const words = text
    .replace(/[^a-z0-9\s]/g, "")
    .split(" ")
    .filter((w) => w && !SIGNATURE_STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .sort();
  return words.join(" ");
}

export function collapseNearDuplicates(candidates: KeywordCandidate[]): KeywordCandidate[] {
  const bySignature = new Map<string, KeywordCandidate>();

  for (const candidate of candidates) {
    // Fall back to the raw text as the key if the signature strips to
    // nothing, so short/stopword-only candidates don't all collapse together.
    const signature = dedupeSignature(candidate.text) || candidate.text;
    const existing = bySignature.get(signature);

    if (!existing) {
      bySignature.set(signature, { ...candidate });
      continue;
    }

    const sources = new Set([...existing.sources, ...candidate.sources]);
    existing.sources = Array.from(sources);
    existing.suggestedBid = existing.suggestedBid ?? candidate.suggestedBid;
    if (candidate.text.length < existing.text.length) {
      existing.text = candidate.text;
    }
  }

  return Array.from(bySignature.values());
}

/**
 * Scores each candidate by how much independent agreement backs it (more
 * sources = more confidence) and whether it's a specific long-tail phrase
 * vs. a single broad word, then fills in a bid for sources that don't carry
 * one of their own (only Ads API does): full confidence terms get the form's
 * default bid, single-source speculative terms get a discounted bid so
 * testing them risks less spend. Returns candidates sorted best-first.
 */
export function scoreAndTierBids(
  candidates: KeywordCandidate[],
  defaultBid: number
): KeywordCandidate[] {
  return candidates
    .map((candidate) => {
      const sourceCount = candidate.sources.length;
      const wordCount = candidate.text.split(" ").length;

      let score = sourceCount * 2 + (wordCount >= 2 ? 1 : 0);
      if (candidate.sources.includes("ads-api")) score += 3;

      let suggestedBid = candidate.suggestedBid;
      if (suggestedBid === undefined) {
        const multiplier = sourceCount >= 2 ? 1 : 0.6;
        suggestedBid = Math.round(defaultBid * multiplier * 100) / 100;
      }

      return { ...candidate, suggestedBid, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

/**
 * Full pipeline from raw per-source candidate groups to the final keyword
 * list handed to the Bulksheet writer: merge + dedupe, collapse near-dupes,
 * then score and tier bids.
 */
export function finalizeKeywords(
  groups: KeywordCandidate[][],
  defaultBid: number
): KeywordCandidate[] {
  const merged = mergeKeywordCandidates(...groups);
  const collapsed = collapseNearDuplicates(merged);
  return scoreAndTierBids(collapsed, defaultBid);
}
