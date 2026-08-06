import { looksLikeAsin } from "./productTargets";
import { BookMetadata, KeywordCandidate, KeywordSource, ProductPageData, RelatedCompetitor } from "./types";

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

// Scraped-page boilerplate that leaks in from rating widgets / review counts
// on product pages ("4.5 out of 5 stars", "955)" from "(4.5 out of 5 stars |
// 955)"). Confirmed present in real bulksheet output — see the learnings doc.
const RATING_BOILERPLATE_PATTERNS = [
  /^\d(\.\d)?\s*out of\s*\d\s*stars?$/i,
  /^\d[\d,]*\)?$/, // bare counts like "955)" or "955"
  /^\d[\d,]*\s*(ratings?|reviews?)$/i,
  /^stars?$/i,
];

export function isScrapedBoilerplate(text: string): boolean {
  return RATING_BOILERPLATE_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Sanity filter for garbled/bot search queries (e.g. "kidle books don't let
 * him i.,;^4ntermedia#££te ngcs.mznv:7" — seen verbatim in a real search term
 * report). Not linguistic, just cheap heuristics: too much of the string is
 * punctuation/symbols, or it has a long run of non-alphanumeric characters.
 */
export function isGarbledText(text: string): boolean {
  if (text.length === 0) return false;
  const letters = (text.match(/[a-z]/gi) ?? []).length;
  if (letters / text.length < 0.5) return true;
  if (/[^a-z0-9\s'-]{3,}/i.test(text)) return true;
  return false;
}

function isUsableKeyword(text: string): boolean {
  if (text.length < 3 || text.length > 80) return false;
  // Drop noisy Open Library / Google Books subjects (URLs, ID-like tags, etc.)
  if (/https?:\/\//.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  if (GENERIC_STANDALONE_TERMS.has(text)) return false;
  if (looksLikeAsin(text)) return false; // route to product targeting instead, see lib/productTargets.ts
  if (isScrapedBoilerplate(text)) return false;
  if (isGarbledText(text)) return false;
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

export function buildBookContentCandidates(commonTerms: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const term of commonTerms) {
    const normalized = normalize(term);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["book-content" as const] }));
}

/**
 * Splits the target book's own "customers also bought" carousel into two
 * source-tagged buckets: the title strings themselves are comparable-title
 * material ("comp-name" — blueprint's Comparable Titles column, high
 * intent), while the comp titles' category/browse-node placement is
 * thematic ("comp-title" — tropes/themes bucket). See
 * lib/keywordMerge.ts#splitKeywordsByCategory for where that split gets used.
 */
export function buildCompTitleCandidates(productPage: ProductPageData): KeywordCandidate[] {
  const titleTexts = new Set<string>();
  for (const title of productPage.compTitles) {
    const normalized = normalize(title);
    if (isUsableKeyword(normalized)) titleTexts.add(normalized);
  }
  const titleCandidates = Array.from(titleTexts).map((text) => ({
    text,
    sources: ["comp-name" as const],
  }));

  const categoryCandidates = buildCategoryCandidates(productPage.categories, "comp-title");
  return mergeKeywordCandidates(titleCandidates, categoryCandidates);
}

/**
 * Comparable-author/title name candidates from the deep "also bought" crawl
 * (scrapeRelatedCompetitors in lib/scrape.ts) — bare, high-intent names
 * rather than thematic phrases. Maps to the blueprint's Comparable Authors /
 * Comparable Titles columns.
 */
export function buildCompNameCandidates(competitors: RelatedCompetitor[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const competitor of competitors) {
    if (competitor.author) {
      const author = normalize(competitor.author);
      if (isUsableKeyword(author)) texts.add(author);
    }
    if (competitor.title) {
      const title = normalize(competitor.title);
      if (isUsableKeyword(title)) texts.add(title);
    }
  }
  return Array.from(texts).map((text) => ({ text, sources: ["comp-name" as const] }));
}

/**
 * Tags the user reviewed and kept on the Autofill book profile (genre/
 * subgenre from Amazon's category breadcrumb, Google Books categories, Open
 * Library subjects, Goodreads shelves — see /api/lookup) get folded straight
 * into the tropes candidate pool as their own high-trust source, and also
 * seed buyer-intent templating and Datamuse synonym expansion in the
 * generate route. A human already vetted these, so they skip the usual
 * generic-term filtering that would otherwise drop a short tag like "cozy".
 */
export function buildKnownTagCandidates(tags: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const tag of tags) {
    const normalized = normalize(tag);
    if (normalized.length >= 2 && normalized.length <= 80) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["user-tag" as const] }));
}

/**
 * Keywords the user typed directly into the "add more" search bar. Same
 * light length check as buildKnownTagCandidates (not the full
 * isUsableKeyword pipeline) — a human explicitly asked for this exact term,
 * so it skips generic-term/phrase-length filtering. The generate route
 * still routes bare ASINs here to product targeting via extractAsinCandidates,
 * and guarantees these a slot in the output regardless of scoring/caps.
 */
export function buildManualKeywordCandidates(keywords: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const keyword of keywords) {
    const normalized = normalize(keyword);
    if (normalized.length >= 2 && normalized.length <= 80) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["manual" as const] }));
}

// Patterns publishers/authors use to explicitly name comparable authors or
// titles in a book's own blurb — a hand-picked, high-confidence signal
// nothing else here sources (comp-title/comp-name come from Amazon's
// algorithmic "also bought" carousel, not the publisher's own marketing copy).
const COMPARABLE_MENTION_PATTERNS = [
  /for (?:fans|readers) of ([^.,;\n]+)/gi,
  /perfect for (?:fans|readers) of ([^.,;\n]+)/gi,
  /if you (?:loved|enjoyed|love|enjoy) ([^.,;\n]+)/gi,
  /in the tradition of ([^.,;\n]+)/gi,
  /reminiscent of ([^.,;\n]+)/gi,
];

function extractComparableMentions(text: string): string[] {
  const names = new Set<string>();
  for (const pattern of COMPARABLE_MENTION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const parts = match[1].split(/,| and | & /i);
      for (const part of parts) {
        const normalized = normalize(part);
        if (isUsableKeyword(normalized)) names.add(normalized);
      }
    }
  }
  return Array.from(names);
}

/**
 * Mines the book's own Amazon description + "About this item" bullets —
 * marketing copy the app didn't previously look at. Two different
 * treatments for two different kinds of signal:
 *  - Explicit comp mentions ("perfect for fans of Richard Osman") become
 *    comp-name candidates — as high-confidence as the deep-crawl comp names,
 *    just hand-picked by the publisher instead of inferred from a carousel.
 *  - Bullets are taken as candidates directly rather than n-gram-mined for
 *    sub-phrases (like review-language does) — a single blurb doesn't repeat
 *    itself, so a frequency filter would zero everything out. Amazon's
 *    feature-bullets for books are often already short marketing phrases in
 *    their own right, so a short (2-8 word) bullet is trustworthy as-is.
 */
export function buildDescriptionCandidates(
  description: string | undefined,
  bulletPoints: string[]
): KeywordCandidate[] {
  const fullText = [description, ...bulletPoints].filter((t): t is string => !!t).join(". ");
  const compNames = extractComparableMentions(fullText).map((text) => ({
    text,
    sources: ["comp-name" as const],
  }));

  const seen = new Set<string>();
  const descriptive: KeywordCandidate[] = [];
  for (const bullet of bulletPoints) {
    const wordCount = bullet.trim().split(/\s+/).length;
    if (wordCount < 2 || wordCount > 8) continue;
    const normalized = normalize(bullet.replace(/\.$/, ""));
    if (!isUsableKeyword(normalized) || seen.has(normalized)) continue;
    seen.add(normalized);
    descriptive.push({ text: normalized, sources: ["book-description" as const] });
  }

  return [...compNames, ...descriptive];
}

/**
 * Splits a finalized keyword list into the two Manual-campaign ad group
 * buckets the research blueprint recommends tracking separately: bare
 * comparable author/title names (high purchase intent, exact match only)
 * vs. everything else (thematic/tropes phrases, moderate bids, broader
 * match types). See lib/bulksheet.ts and the generate route for how each
 * bucket becomes its own Ad Group.
 */
export function splitKeywordsByCategory(keywords: KeywordCandidate[]): {
  tropes: KeywordCandidate[];
  compNames: KeywordCandidate[];
} {
  const tropes: KeywordCandidate[] = [];
  const compNames: KeywordCandidate[] = [];
  for (const keyword of keywords) {
    if (keyword.sources.includes("comp-name")) compNames.push(keyword);
    else tropes.push(keyword);
  }
  return { tropes, compNames };
}

const BUYER_INTENT_GENRE_LIMIT = 6;
const FORMAT_MODIFIERS = ["hardcover", "paperback", "hard back", "kindle books"];

/**
 * Crosses the top genre/subject terms already extracted from metadata with
 * generic buyer-intent phrasing, plus format/series-order/recency templates
 * — no extra API calls, just templating on data we already fetched. Pattern
 * choices (format modifiers, series-order queries, recency/bestseller
 * modifiers) are drawn from a real 30-day search term report; see the
 * learnings doc.
 */
export function buildBuyerIntentCandidates(
  genreTerms: string[],
  params: { title?: string; author?: string; seriesName?: string } = {}
): KeywordCandidate[] {
  const { title, author, seriesName } = params;
  const texts = new Set<string>();
  const currentYear = new Date().getFullYear();

  for (const genre of genreTerms.slice(0, BUYER_INTENT_GENRE_LIMIT)) {
    texts.add(`best ${genre} books`);
    texts.add(`${genre} books`);
    texts.add(`${genre} novel`);
    texts.add(`new ${genre} books ${currentYear}`);
    texts.add(`best selling ${genre} books`);
  }

  for (const format of FORMAT_MODIFIERS) {
    if (title) texts.add(`${title} ${format}`);
    if (author) texts.add(`${author} ${format}`);
  }

  if (title) {
    texts.add(`books like ${title}`);
  }
  if (author) {
    texts.add(author);
    texts.add(`${author} books`);
    texts.add(`${author} books in order`);
  }
  if (seriesName) {
    texts.add(`${seriesName} books in order`);
    texts.add(`${seriesName} series`);
  }

  return Array.from(texts)
    .map((text) => normalize(text))
    .filter(isUsableKeyword)
    .map((text) => ({ text, sources: ["buyer-intent" as const] }));
}

/**
 * Auto-targeting search terms sometimes surface bare ASINs (Amazon's
 * complements/substitutes clauses match against other *products*, not text —
 * see the learnings doc). Those belong on the product-targeting side, not in
 * the keyword list, so split them out before anything reaches isUsableKeyword
 * (which would otherwise just silently drop them).
 */
export function extractAsinCandidates(candidates: KeywordCandidate[]): {
  keywords: KeywordCandidate[];
  asins: string[];
} {
  const keywords: KeywordCandidate[] = [];
  const asins: string[] = [];

  for (const candidate of candidates) {
    const text = candidate.text.trim();
    if (looksLikeAsin(text)) {
      asins.push(text.toUpperCase());
    } else {
      keywords.push(candidate);
    }
  }

  return { keywords, asins };
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

// The manual research blueprint's filter for the alphabet-soup harvest:
// "only add phrases 3 to 5 words long... ignore generic single or two-word
// terms." Applied here as a scoring bonus rather than a hard cutoff (a
// strong 2-word comp-author name shouldn't be excluded), so ideal-length
// phrases simply rank higher.
function phraseLengthScore(wordCount: number): number {
  if (wordCount >= 3 && wordCount <= 5) return 2;
  if (wordCount === 2 || wordCount === 6) return 1;
  return 0;
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

      let score = sourceCount * 2 + phraseLengthScore(wordCount);
      if (candidate.sources.includes("ads-api")) score += 3;
      // A human reviewed and kept this tag on the Autofill book profile —
      // worth trusting more than an algorithmically-agreed-upon term, though
      // not as much as real Ads API bid data.
      if (candidate.sources.includes("user-tag")) score += 2;

      let suggestedBid = candidate.suggestedBid;
      if (suggestedBid === undefined) {
        const multiplier = sourceCount >= 2 ? 1 : 0.6;
        suggestedBid = Math.round(defaultBid * multiplier * 100) / 100;
      }

      return { ...candidate, suggestedBid, score };
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

// Amazon's own keyword-targeting guidance is to add 25-50 relevant keywords
// per ad group: enough for coverage without diluting focus/budget across too
// many terms (advertising.amazon.com's automated-fetch blocking meant this
// was corroborated via secondary sources quoting Amazon's public guide,
// rather than pulled directly from the primary page — worth a spot check
// against Seller Central's own current guidance if it matters precisely).
export const RECOMMENDED_MIN_KEYWORDS = 25;
export const RECOMMENDED_MAX_KEYWORDS = 50;

// Blueprint's Comparable Authors/Titles harvest targets ~20-40 direct
// competitors; caps the comp-names ad group independently of the tropes cap
// above since they're two separate ad groups now, not one shared budget.
export const COMP_NAME_MAX_KEYWORDS = 40;

/**
 * Full pipeline from raw per-source candidate groups to the final keyword
 * list handed to the Bulksheet writer: merge + dedupe, collapse near-dupes,
 * score and tier bids, then cap at a per-ad-group ceiling (defaults to
 * Amazon's recommended RECOMMENDED_MAX_KEYWORDS), keeping the best-scoring
 * keywords first.
 */
export function finalizeKeywords(
  groups: KeywordCandidate[][],
  defaultBid: number,
  maxResults: number = RECOMMENDED_MAX_KEYWORDS
): KeywordCandidate[] {
  const merged = mergeKeywordCandidates(...groups);
  const collapsed = collapseNearDuplicates(merged);
  const scored = scoreAndTierBids(collapsed, defaultBid);
  return scored.slice(0, maxResults);
}
