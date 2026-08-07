import { looksLikeAsin } from "./productTargets";
import { expandSynonyms } from "./synonyms";
import { extractKeyPhrases } from "./textExtract";
import { BookMetadata, KeywordCandidate, KeywordSource, ProductPageData, RelatedCompetitor } from "./types";

export function normalize(text: string): string {
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
  "audiobook",
  "audiobooks",
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
  "crime",
  "mystery",
  "thriller",
  "romance",
  "fantasy",
  "science fiction",
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

export function isUsableKeyword(text: string): boolean {
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

// Increased from 6 to 10 to use more genre terms for buyer-intent templating.
// Most books have 5-8 genres, so 10 is safe without dilution.
const BUYER_INTENT_GENRE_LIMIT = 10;
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
 * Runs the local RAKE extractor (lib/textExtract.ts) over free-form scraped
 * text and wraps the resulting phrases as candidates under `source`. Shared
 * by the content-mining sources below since they differ only in where the
 * raw text came from.
 *
 * Note: Increased phrase limit from 20 to 30 to capture more variety,
 * especially important for rich description text.
 */
function buildTextMiningCandidates(texts: string[], source: KeywordSource, maxPhrases: number = 30): KeywordCandidate[] {
  const combined = texts.join(". ");
  const phrases = extractKeyPhrases(combined, maxPhrases);
  const usable = new Set<string>();
  for (const phrase of phrases) {
    const normalized = normalize(phrase);
    if (isUsableKeyword(normalized)) usable.add(normalized);
  }
  return Array.from(usable).map((text) => ({ text, sources: [source] }));
}

/**
 * RAKE-mines the raw description prose (as opposed to buildDescriptionCandidates,
 * which only looks at explicit comp mentions and the feature bullets) for
 * additional thematic phrases. Folded into the same "book-description"
 * bucket rather than its own source.
 */
export function buildDescriptionPhraseCandidates(description: string | undefined): KeywordCandidate[] {
  if (!description) return [];
  return buildTextMiningCandidates([description], "book-description");
}

export function buildQnaCandidates(questions: string[]): KeywordCandidate[] {
  return buildTextMiningCandidates(questions, "customer-qna");
}

/**
 * Local, offline expansion of already-extracted genre terms into related
 * buyer-search phrasing via the curated book-genre thesaurus in
 * lib/synonyms.ts — a complementary signal to the Datamuse-based synonym
 * expansion (lib/datamuse.ts), which the generate route merges into the
 * same "synonym" bucket.
 */
export function buildCuratedSynonymCandidates(genreTerms: string[]): KeywordCandidate[] {
  const expanded = expandSynonyms(genreTerms);
  const texts = new Set<string>();
  for (const term of expanded) {
    const normalized = normalize(term);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["synonym" as const] }));
}

export function buildWikipediaCandidates(categories: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const category of categories) {
    const normalized = normalize(category);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["wikipedia" as const] }));
}

export function buildWikidataCandidates(genres: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const genre of genres) {
    const normalized = normalize(genre);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["wikidata" as const] }));
}

/**
 * LCSH subject strings often chain subdivisions with " -- " (e.g. "Great
 * Britain -- History -- Fiction"); split those into individual thematic
 * terms the same way category strings are split above.
 */
export function buildLocCandidates(subjects: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const subject of subjects) {
    for (const piece of subject.split(/--/)) {
      const normalized = normalize(piece);
      if (isUsableKeyword(normalized)) texts.add(normalized);
    }
  }
  return Array.from(texts).map((text) => ({ text, sources: ["loc-subjects" as const] }));
}

/**
 * The author's other book titles (lib/scrape.ts#scrapeAuthorCatalog) are a
 * stronger-signal replacement for comp-title mining, so they're tagged
 * "comp-name" for ad-group routing (see splitKeywordsByCategory) even though
 * they're tracked as their own toggle/status under the "author-catalog" key
 * in the generate route — the same mixed-tag pattern buildDescriptionCandidates
 * uses for its comp-mention half.
 */
export function buildAuthorCatalogCandidates(titles: string[]): KeywordCandidate[] {
  const texts = new Set<string>();
  for (const title of titles) {
    const normalized = normalize(title);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }
  return Array.from(texts).map((text) => ({ text, sources: ["comp-name" as const] }));
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

// Category-based scoring: certain keyword categories are inherently more
// valuable for book advertising (core genre, character tropes) than others
// (seasonal, gift-specific).
function categoryRelevanceScore(category: string | undefined): number {
  if (!category) return 0;
  // High-value categories that drive targeted searches
  const highValue = new Set([
    "core-genre",
    "sub-genre",
    "competing-authors",
    "comp-titles",
    "character-tropes",
    "relationship-tropes",
    "plot-devices",
    "setting-aesthetic",
  ]);
  // Medium-value categories
  const mediumValue = new Set([
    "series-names",
    "mood-tone",
    "time-period",
    "award-bestseller",
    "age-demographic",
  ]);
  // Lower-value but still useful
  const lowValue = new Set([
    "format",
    "gift",
    "problem-solving",
    "skill-goal",
    "identity-cultural",
    "synonym-alt",
    "seasonal-holiday",
  ]);

  if (highValue.has(category)) return 2;
  if (mediumValue.has(category)) return 1;
  if (lowValue.has(category)) return 0.5;
  return 0;
}

// Source diversity quality score: rare but highly specific keywords
// shouldn't be penalized just for coming from one source. A 4-word
// phrase from review mining is worth more than a generic term that
// appears in 3 sources.
function sourceQualityScore(sourceCount: number, wordCount: number): number {
  // Single-source keywords: check if they're specific enough to trust
  if (sourceCount === 1) {
    // Specific long phrases (4+ words) from one source are high quality
    if (wordCount >= 4) return 1.5; // Good-quality rare phrase
    if (wordCount === 3) return 0.5; // Decent quality
  }
  // Two sources: reliable but not confirmed-agreement yet
  if (sourceCount === 2 && wordCount >= 3) return 1;
  return 0;
}

/**
 * Scores each candidate by how much independent agreement backs it (more
 * sources = more confidence), keyword category relevance, phrase specificity,
 * and source authority. Fills in bids for sources that don't carry one of
 * their own (only Ads API does). Returns candidates sorted best-first.
 *
 * Scoring factors (in order of weight):
 * 1. Source agreement (base 2 points per source)
 * 2. Ads API authority (+3)
 * 3. User-provided sources (+2 for user-tag, +2.5 for key-trope)
 * 4. Category relevance (0-2 based on semantic value)
 * 5. Phrase length vs. breadth (ideal 3-5 word phrases)
 * 6. Source quality (rare but specific phrases get bonus)
 */
export function scoreAndTierBids(
  candidates: KeywordCandidate[],
  defaultBid: number
): KeywordCandidate[] {
  return candidates
    .map((candidate) => {
      const sourceCount = candidate.sources.length;
      const wordCount = candidate.text.split(" ").length;

      // Base: source agreement is the strongest signal
      let score = sourceCount * 2 + phraseLengthScore(wordCount);

      // Authority signals (high confidence)
      if (candidate.sources.includes("ads-api")) score += 3;
      // User-reviewed tags from Autofill — human vetted, very trustworthy
      if (candidate.sources.includes("user-tag")) score += 2;
      // User-supplied tropes/themes — book-specific, highest-trust user signal
      if (candidate.sources.includes("key-trope")) score += 2.5;

      // Category relevance — semantic signal about keyword quality
      const categoryScore = categoryRelevanceScore(candidate.category);
      score += categoryScore;

      // Source quality bonus: rare but highly specific keywords deserve credit
      // (e.g., a 4-word phrase from one high-quality source)
      const qualityScore = sourceQualityScore(sourceCount, wordCount);
      score += qualityScore;

      // Source diversity bonus: if keyword appears in manual + discovered,
      // it's strongly aligned with user intent (not just algorithmic).
      const hasManualSource = candidate.sources.includes("manual");
      const hasNonManualSource = candidate.sources.some(
        (s) => s !== "manual" && s !== "user-tag" && s !== "key-trope"
      );
      if (hasManualSource && hasNonManualSource) {
        score += 1.5; // User-validated keyword
      }

      let suggestedBid = candidate.suggestedBid;
      if (suggestedBid === undefined) {
        // Bid multiplier: multi-source keywords are more confident, bid higher
        // Single-source high-quality phrases still get decent bid (0.75)
        let multiplier = 0.6;
        if (sourceCount >= 3) multiplier = 1;
        else if (sourceCount === 2) multiplier = 0.9;
        else if (wordCount >= 4) multiplier = 0.75; // Boost specific rare phrases
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
 * Boosts scores for keywords from high-quality competitor books (bestsellers,
 * high ratings, many reviews). Used for "comp-name" keywords sourced from the
 * deep competitor crawl.
 */
export function boostScoresByCompetitorQuality(
  candidates: KeywordCandidate[],
  competitors: RelatedCompetitor[],
  boostMultiplier: number = 0.15 // Up to 15% boost
): KeywordCandidate[] {
  if (boostMultiplier <= 0 || competitors.length === 0) return candidates;

  const competitorTitles = new Map<string, number>();
  const competitorAuthors = new Map<string, number>();

  // Build maps of competitor titles/authors → quality score (0-1)
  for (const comp of competitors) {
    let quality = 0;

    // Bestseller rank (most reliable)
    if (comp.bestSellerRank !== undefined) {
      if (comp.bestSellerRank <= 100) quality += 0.4;
      else if (comp.bestSellerRank <= 1000) quality += 0.25;
      else if (comp.bestSellerRank <= 10000) quality += 0.15;
      else quality += 0.05;
    }

    // Rating signal
    if (comp.rating !== undefined) {
      if (comp.rating >= 4.5) quality += 0.35;
      else if (comp.rating >= 4.0) quality += 0.25;
      else if (comp.rating >= 3.5) quality += 0.15;
      else quality += 0.05;
    }

    // Review count signal
    if (comp.reviewCount !== undefined) {
      if (comp.reviewCount >= 1000) quality += 0.35;
      else if (comp.reviewCount >= 500) quality += 0.25;
      else if (comp.reviewCount >= 100) quality += 0.15;
      else if (comp.reviewCount >= 10) quality += 0.05;
    }

    const finalQuality = Math.min(quality, 1);

    if (comp.title) {
      const normalized = normalize(comp.title);
      competitorTitles.set(normalized, Math.max(competitorTitles.get(normalized) ?? 0, finalQuality));
    }
    if (comp.author) {
      const normalized = normalize(comp.author);
      competitorAuthors.set(normalized, Math.max(competitorAuthors.get(normalized) ?? 0, finalQuality));
    }
  }

  // Apply boosts to matching keywords
  return candidates.map((candidate) => {
    const normalized = normalize(candidate.text);
    const titleQuality = competitorTitles.get(normalized) ?? 0;
    const authorQuality = competitorAuthors.get(normalized) ?? 0;
    const maxQuality = Math.max(titleQuality, authorQuality);

    if (maxQuality > 0) {
      const scoreBoost = maxQuality * boostMultiplier * 10; // Convert to score points
      return { ...candidate, score: (candidate.score ?? 0) + scoreBoost };
    }
    return candidate;
  });
}

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
