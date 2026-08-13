/**
 * Post-generation keyword filter pipeline.
 *
 * The generator is source-led: every source adds what it found, and until
 * now nothing validated the result against the book before it was written to
 * the keyword list. That is why a Scottish crime thriller came out of the
 * pipeline bidding on "scottish fold cat", "felon books", "his team was put"
 * and "264 pages" — each individually explicable, none of them a query a
 * reader of that book would type.
 *
 * This module is the shared validation layer that was missing. It runs after
 * generation and before persistence/activation, as an ordered pipeline where
 * each filter returns:
 *
 *   reject — never bid on this; stored with the rejecting filter + reason
 *   pause  — plausible but unproven; stored, not activated
 *   pass   — continue to the next filter
 *
 * `pause` and `reject` are both terminal: the first filter with an opinion
 * owns the outcome, so the reason recorded on the keyword is the reason a
 * human would give. Everything book-specific comes from the anchors derived
 * at scrape time (lib/keywordAnchors.ts); everything tunable lives in
 * lib/keywordFilterConfig.ts.
 */

import { buildBookAnchors, coreTitle, profileOf, qualifyingAnchors, type AnchorInput, type BookAnchors } from "./keywordAnchors";
import {
  ALLOWED_GENRE_SYNONYMS,
  ALLOWLISTED_MODIFIER_PHRASES,
  AMBIGUOUS_TITLE_TAILS,
  AUDIENCE_MISMATCH_TERMS,
  AUTHOR_DISAMBIGUATION_PATTERN,
  BAD_SYNONYM_TERMS,
  BOOK_DOMAIN_WORDS,
  BOOK_INTENT_WORDS,
  BOOK_SIGNAL_WORDS,
  DEMONYM_TERMS,
  DESCRIPTION_VERB_TOKENS,
  FORMAT_PATTERNS,
  GIFT_AUDIENCE_PAUSE_WORDS,
  GIFT_AUDIENCE_REJECT_WORDS,
  GIFT_INTENT_TERMS,
  KINDLE_UNLIMITED_PATTERN,
  MARKET_LANGUAGES,
  MARKETPLACE_BOILERPLATE_TERMS,
  MARKETPLACE_SERP_SOURCES,
  MEDIA_FORM_TERMS,
  METADATA_LABEL_TERMS,
  NON_MARKET_LANGUAGES,
  OFF_TOPIC_ENTITY_TERMS,
  PLATFORM_META_TERMS,
  PLATFORM_TERMS,
  PRODUCT_NOUNS,
  PRODUCT_UNIT_PATTERNS,
  PRODUCT_WEAK_SIGNALS,
  type ReasonCode,
  REVIEW_FILLER_FRAGMENTS,
  REVIEW_SPEAK_ADJECTIVES,
  REVIEW_SPEAK_NOUNS,
  REVIEW_STOPWORDS,
  SEASONAL_TERMS,
  SEASON_WINDOWS,
  SELF_ANCHORED_SOURCES,
  SINGLE_WORD_PAUSE_TERMS,
  TITLE_COLLISION_TERMS,
  UI_POLLUTION_TERMS,
  WEAK_CONNECTORS,
  WEB_AUTOCOMPLETE_SOURCES,
} from "./keywordFilterConfig";
import { isApprovedAuthor } from "./manualCompetitors";
import type { KeywordCandidate, Marketplace, MatchType } from "./types";

export type FilterVerdict = "pass" | "pause" | "reject";

export interface FilterResult {
  verdict: FilterVerdict;
  reason?: string;
  /** Machine-readable reason code (brief §5.10), alongside the human-readable reason. */
  code?: ReasonCode;
  /** Set by phraseShape when a dangling modifier can be completed instead of dropped. */
  rewriteTo?: string;
  /** Set by the description-shaping filter: these are long-tail phrases, never Broad. */
  matchTypeCeiling?: MatchType;
}

export interface FilterableKeyword {
  text: string;
  /** Candidate sources (generation time) or the single stored source column (migration time). */
  sources?: string[];
  source?: string | null;
}

export interface FilterContext {
  anchors: BookAnchors;
  marketplace: Marketplace;
  /** The listing's own language, when the scrape captured one. */
  language?: string;
  /** Formats confirmed available on the ASIN or its sibling editions ("kindle", "paperback", …). */
  formats: string[];
  isKindleUnlimited: boolean;
  /** Set when the scrape found a translated edition, which re-opens the language filter. */
  hasTranslationEdition?: boolean;
  /** Injectable for tests and for judging season windows deterministically. */
  now: Date;
  /** The book's real author, for authorDisambiguationFilter. */
  actualAuthor?: string;
  /** The book's own ASIN, for the manual-competitors approved-comp-author lookup. */
  asin?: string;
  /** The book's raw title, for assignPassReason's BOOK_SPECIFIC_MATCH check. */
  title?: string;
  /** The book's series name, for assignPassReason's SERIES_NAME_MATCH check. */
  seriesName?: string;
}

export type KeywordFilter = (keyword: string, context: FilterContext, sources: string[]) => FilterResult;

const PASS: FilterResult = { verdict: "pass" };

// --- text helpers ---------------------------------------------------------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * lowercase, trim, collapse whitespace, drop punctuation noise. Hyphens and
 * apostrophes survive ("law-breaking", "don't"); colons, commas and stray
 * symbols become spaces so scraped labels normalise into plain words.
 */
export function normalizeKeyword(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-'\s]+|[-'\s]+$/g, "")
    .trim();
}

// containsTerm is the pipeline's innermost operation — every filter tests
// every keyword against one or more term lists (blocklists, anchors), so a
// single generate/filter run on a full-size book (up to BOOK_KEYWORD_MAX +
// BOOK_COMP_NAME_MAX keywords) can call it hundreds of thousands of times.
// `term` comes from a bounded vocabulary (the config blocklists plus this
// book's own anchors), so caching the compiled pattern per term — instead of
// recompiling it on every call — is a straightforward, unbounded-growth-free
// win.
const TERM_PATTERN_CACHE = new Map<string, RegExp>();

function termPattern(term: string): RegExp {
  let pattern = TERM_PATTERN_CACHE.get(term);
  if (!pattern) {
    pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(term)}([^a-z0-9]|$)`, "i");
    TERM_PATTERN_CACHE.set(term, pattern);
  }
  return pattern;
}

/** Word-boundary containment — "pages" must not match "page turner", "open" must not match "opening". */
export function containsTerm(text: string, term: string): boolean {
  return termPattern(term).test(text);
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function firstMatch(text: string, terms: string[]): string | undefined {
  return terms.find((term) => containsTerm(text, term));
}

function hasAnyAnchor(text: string, anchors: string[]): string | undefined {
  return anchors.find((anchor) => anchor.length >= 3 && containsTerm(text, anchor));
}

// `context` (and its anchors) is built once per generate/filter run and then
// reused for every keyword in the batch, but withoutAnchoredTerms used to
// redo its O(terms × anchors) filtering from scratch on every single call —
// same context, same terms list, same result, recomputed per keyword across
// up to five call sites in the pipeline below. Cached per (context, terms)
// pair via WeakMaps, so the result is computed once per batch and reused for
// the rest of it; both WeakMaps drop their entries once the run's context
// object is no longer referenced, so this can't leak across books.
const ANCHORED_TERMS_CACHE = new WeakMap<FilterContext, WeakMap<string[], string[]>>();

// That cache is keyed on the *identity* of the terms array, so a call site
// deriving its list inline (`SOME_TERMS.filter(...)`) allocates a fresh key
// per keyword and never hits it — the O(terms × anchors) scan then runs once
// per keyword instead of once per batch, which is what the cache exists to
// prevent. The two derived lists in the pipeline are memoised here so each
// resolves to a single stable array: non-market languages keyed by the
// marketplace's own language, and off-profile demonyms keyed by the
// profile's `nationality` array (profileOf returns the anchors' own profile,
// so that array's identity is fixed for the life of the context).
const NON_MARKET_LANGUAGE_CACHE = new Map<string, string[]>();

function nonMarketLanguages(marketLanguage: string): string[] {
  let languages = NON_MARKET_LANGUAGE_CACHE.get(marketLanguage);
  if (!languages) {
    languages = NON_MARKET_LANGUAGES.filter((language) => language !== marketLanguage);
    NON_MARKET_LANGUAGE_CACHE.set(marketLanguage, languages);
  }
  return languages;
}

const OFF_NATIONALITY_CACHE = new WeakMap<string[], string[]>();

function offNationalityDemonyms(nationality: string[]): string[] {
  let demonyms = OFF_NATIONALITY_CACHE.get(nationality);
  if (!demonyms) {
    demonyms = DEMONYM_TERMS.filter((term) => !nationality.includes(term));
    OFF_NATIONALITY_CACHE.set(nationality, demonyms);
  }
  return demonyms;
}

/** Blocklist terms that are part of what this book *is* are not blocklist terms for this book. */
function withoutAnchoredTerms(terms: string[], context: FilterContext): string[] {
  let perContext = ANCHORED_TERMS_CACHE.get(context);
  if (!perContext) {
    perContext = new WeakMap();
    ANCHORED_TERMS_CACHE.set(context, perContext);
  }
  const cached = perContext.get(terms);
  if (cached) return cached;

  const anchors = qualifyingAnchors(context.anchors);
  const filtered = terms.filter((term) => !anchors.some((anchor) => containsTerm(anchor, term)));
  perContext.set(terms, filtered);
  return filtered;
}

function isWebAutocomplete(sources: string[]): boolean {
  return sources.some((source) => WEB_AUTOCOMPLETE_SOURCES.includes(source));
}

// --- 1. UI / metadata pollution -------------------------------------------

/**
 * Amazon page chrome and admin-UI labels. Runs first: "264 pages" and
 * "see top 100 in kindle store" are never keywords, whatever else is true
 * about them, and killing them here stops every later filter from having to
 * reason about scrape artifacts.
 */
export const uiPollutionFilter: KeywordFilter = (keyword) => {
  const term = firstMatch(keyword, UI_POLLUTION_TERMS);
  if (term) return { verdict: "reject", reason: `page/UI chrome: "${term}"` };

  // Detail-table labels: only when the keyword *leads* with one, so
  // "sign language books" and "best rating books" survive while
  // "language english" and "publisher bookouture" do not.
  const label = METADATA_LABEL_TERMS.find((candidate) => new RegExp(`^${escapeRegExp(candidate)}\\b`).test(keyword));
  if (label) return { verdict: "reject", reason: `listing metadata label: "${label}"` };

  // A bare number, or a number followed by a unit, is a detail row rather
  // than a query ("264", "1,024 kb"). A number in front of real words is
  // left to the filters that understand the source it came from.
  if (/^[\d,.]+$/.test(keyword) || /^\d[\d,]*\s*(kb|mb|gb|hours?|minutes?|mins?|words?)\b/.test(keyword)) {
    return { verdict: "reject", reason: "listing measurement, not a query" };
  }

  return PASS;
};

// --- 2. Language & marketplace --------------------------------------------

/**
 * A UK English listing has no reason to bid on "crime thriller books
 * malayalam" — those searches want a translation that does not exist.
 * Languages the book is actually set in/about are exempt (they're anchors),
 * and the marketplace's own language pauses instead of rejecting: "crime
 * thriller books in english" is valid, just low value.
 */
export const languageMarketFilter: KeywordFilter = (keyword, context) => {
  const marketLanguage = MARKET_LANGUAGES[context.marketplace] ?? "english";
  const listingLanguage = context.language?.toLowerCase();
  if (listingLanguage && !listingLanguage.includes(marketLanguage)) return PASS;
  if (context.hasTranslationEdition) return PASS;

  const foreign = firstMatch(keyword, withoutAnchoredTerms(nonMarketLanguages(marketLanguage), context));
  if (foreign) return { verdict: "reject", reason: `non-market language: "${foreign}"` };

  // Naming the marketplace's own language is valid but low value — *if* the
  // keyword is otherwise about this book. "crime thriller books in english"
  // pauses; "english books" is not a language keyword at all, and is left to
  // the filters that judge it as the over-broad term it is.
  if (containsTerm(keyword, marketLanguage) && hasAnyAnchor(keyword, qualifyingAnchors(context.anchors))) {
    return { verdict: "pause", reason: `names the marketplace's own language ("${marketLanguage}")` };
  }

  return PASS;
};

// --- 3. Off-topic entities (autocomplete drift) ---------------------------

/**
 * Autocomplete engines expand a seed into whatever else shares its prefix:
 * "scottish" reaches "scottish fold cat" and "scottish premier league
 * fixtures", "scars of the past" reaches a World of Warcraft quest. Two
 * rules — a blocklist of the domains it drifts into, and a requirement that
 * anything from a general-web engine still look like a book search.
 */
export const offTopicEntityFilter: KeywordFilter = (keyword, context, sources) => {
  const term = firstMatch(keyword, withoutAnchoredTerms(OFF_TOPIC_ENTITY_TERMS, context));
  if (term) return { verdict: "reject", reason: `off-topic entity: "${term}"` };

  if (isWebAutocomplete(sources)) {
    const hasDomainWord = !!firstMatch(keyword, BOOK_DOMAIN_WORDS);
    const hasBookAnchor = !!hasAnyAnchor(keyword, context.anchors.bookSpecific);
    if (!hasDomainWord && !hasBookAnchor) {
      return { verdict: "reject", reason: "autocomplete suggestion with no book-domain word" };
    }
  }

  return PASS;
};

// --- 3a. Physical products, gift/marketplace intent, boilerplate (§5.1-5.3) --

/**
 * SERP scraping for "scottish/british/irish" surfaces Amazon souvenir
 * listings — mugs, tea, socks — that share a nationality token with the book
 * but are not a book at all. Being a book is necessary but not sufficient
 * (handled next by the SERP book-intent gate and the subgenre filter).
 */
export const physicalProductFilter: KeywordFilter = (keyword) => {
  const unitMatch = PRODUCT_UNIT_PATTERNS.some((pattern) => pattern.test(keyword));
  const strongNoun = firstMatch(keyword, PRODUCT_NOUNS);
  const weakSignals = PRODUCT_WEAK_SIGNALS.filter((term) => containsTerm(keyword, term)).length;
  const hasBookSignal = !!firstMatch(keyword, BOOK_SIGNAL_WORDS);

  if (hasBookSignal) return PASS;

  if (unitMatch || strongNoun || weakSignals >= 2) {
    const signal = strongNoun ?? (unitMatch ? "unit/size/pack" : "material/colour tokens");
    return { verdict: "reject", code: "PRODUCT", reason: `physical-product signal: "${signal}"` };
  }

  return PASS;
};

/**
 * Marketplace/SERP scrapes carry no guarantee the result is a book at all —
 * "british gifts" and "irish food" are pure gift/souvenir intent with no
 * book signal to redeem them.
 */
export const bookIntentGateFilter: KeywordFilter = (keyword, context, sources) => {
  if (!sources.some((source) => MARKETPLACE_SERP_SOURCES.includes(source))) return PASS;

  const hasBookSignal = !!firstMatch(keyword, BOOK_SIGNAL_WORDS);
  const hasComp = !!hasAnyAnchor(keyword, context.anchors.comps);
  if (hasBookSignal || hasComp) return PASS;

  const gift = firstMatch(keyword, GIFT_INTENT_TERMS);
  if (gift) return { verdict: "reject", code: "GIFT_INTENT", reason: `gift/souvenir query, no book signal ("${gift}")` };

  return { verdict: "reject", code: "GIFT_INTENT", reason: "marketplace/SERP result with no book or comp signal" };
};

/** Amazon page furniture ("shop the store on amazon") is not an author or title. */
export const marketplaceBoilerplateFilter: KeywordFilter = (keyword) => {
  const term = firstMatch(keyword, MARKETPLACE_BOILERPLATE_TERMS);
  if (term) return { verdict: "reject", code: "BOILERPLATE", reason: `marketplace boilerplate: "${term}"` };
  return PASS;
};

// --- 3b. Subgenre scoring against the book profile (§5.4) -------------------

/**
 * Scores a candidate against the book profile's genre_core / genre_adjacent
 * / genre_deny lists. A deny-subgenre hit with no core/adjacent redemption
 * is dropped outright; a deny hit alongside a core hit is ambiguous enough
 * to review rather than decide automatically.
 */
export const subgenreFilter: KeywordFilter = (keyword, context) => {
  const { genreCore, genreAdjacent, genreDeny } = profileOf(context.anchors);
  if (genreCore.length === 0 && genreAdjacent.length === 0 && genreDeny.length === 0) return PASS;

  const deny = firstMatch(keyword, genreDeny);
  const core = firstMatch(keyword, genreCore);
  const adjacent = firstMatch(keyword, genreAdjacent);

  if (deny && core) {
    return { verdict: "pause", code: "OFF_SUBGENRE", reason: `deny-subgenre "${deny}" alongside core-genre "${core}"` };
  }
  if (deny) {
    return { verdict: "reject", code: "OFF_SUBGENRE", reason: `deny-subgenre term: "${deny}"` };
  }
  if (core || adjacent) return PASS;

  return PASS;
};

// --- 3c. Tone & nationality guards for template sources (§5.5) --------------

/**
 * Template expansion (adjective × genre) is tone- and nationality-blind by
 * construction: "heartwarming scottish crime fiction" is a real cell in the
 * matrix and a contradiction in terms. Nationality only expands within the
 * book profile's own nationality list.
 */
export const toneNationalityFilter: KeywordFilter = (keyword, context) => {
  const { tone, toneDeny, nationality } = profileOf(context.anchors);

  if (toneDeny.length > 0) {
    const denyTone = firstMatch(keyword, toneDeny);
    if (denyTone) return { verdict: "reject", code: "TONE_MISMATCH", reason: `tone_deny term: "${denyTone}"` };
  }

  if (nationality.length > 0) {
    const badDemonym = firstMatch(keyword, withoutAnchoredTerms(offNationalityDemonyms(nationality), context));
    if (badDemonym) {
      return { verdict: "reject", code: "NATIONALITY_MISMATCH", reason: `demonym outside the book's nationality: "${badDemonym}"` };
    }
  }

  if (tone.length > 0 && firstMatch(keyword, tone)) return PASS;
  return PASS;
};

// --- 3d. Audience / format / language / platform guards (§5.7) --------------

export const audienceFormatPlatformFilter: KeywordFilter = (keyword, context) => {
  const { audience, formatsNotOffered } = profileOf(context.anchors);

  if (audience === "adult") {
    const mismatch = firstMatch(keyword, AUDIENCE_MISMATCH_TERMS);
    if (mismatch) return { verdict: "reject", code: "AUDIENCE_MISMATCH", reason: `audience mismatch: "${mismatch}"` };
  }

  const badFormat = formatsNotOffered.find((format) => containsTerm(keyword, format));
  if (badFormat) return { verdict: "reject", code: "FORMAT_NOT_OFFERED", reason: `format not offered: "${badFormat}"` };

  const platform = firstMatch(keyword, PLATFORM_META_TERMS);
  if (platform) return { verdict: "pause", code: "PLATFORM_META", reason: `platform meta-intent: "${platform}"` };

  return PASS;
};

// --- 3e. Title-collision detection for autocomplete sources (§5.8) ----------

/**
 * Autocomplete completions of the title that pick up a collision token
 * (game/media/dictionary vocabulary already curated for the negative list)
 * are dropped; ambiguous numeric tails ("scars of the past two") could be a
 * series book or a collision, so they go to review instead of a decision.
 */
export const titleCollisionFilter: KeywordFilter = (keyword, context, sources) => {
  if (!sources.some((source) => WEB_AUTOCOMPLETE_SOURCES.includes(source) || source === "google-autocomplete")) {
    return PASS;
  }
  const title = context.anchors.bookSpecific.find((anchor) => keyword.startsWith(anchor));
  if (!title) return PASS;

  const collision = firstMatch(keyword, TITLE_COLLISION_TERMS);
  if (collision) return { verdict: "reject", code: "TITLE_COLLISION", reason: `title-collision term: "${collision}"` };

  const tail = keyword.slice(title.length).trim();
  if (tail && AMBIGUOUS_TITLE_TAILS.includes(tail)) {
    return { verdict: "pause", code: "TITLE_COLLISION", reason: `ambiguous tail on the title: "${tail}"` };
  }

  return PASS;
};

// --- 3f. Media-type collision (§5.1) ----------------------------------------

/**
 * Autocomplete drags a book title that also happens to be a song/album/
 * episode name into music/TV/video vocabulary — "the unforgiven guitar tab"
 * (Metallica), "the unforgiven full movie". Only fires when the keyword also
 * carries one of this book's own title/author/series anchors, so genuinely
 * unrelated media queries are left to offTopicEntityFilter.
 */
export const mediaTypeCollisionFilter: KeywordFilter = (keyword, context) => {
  const media = firstMatch(keyword, MEDIA_FORM_TERMS);
  if (!media) return PASS;
  if (!hasAnyAnchor(keyword, context.anchors.bookSpecific)) return PASS;
  return { verdict: "reject", code: "MEDIA_COLLISION", reason: `media-type collision: "${media}"` };
};

// --- 3g. Platform/marketplace noise (§5.4) ----------------------------------

/**
 * Streaming/social/marketplace platform vocabulary ("booktok", "netflix") is
 * platform navigation on its own. Kept — paused, not rejected — only when
 * the keyword also carries a book anchor plus book intent; otherwise dropped.
 */
export const platformNoiseFilter: KeywordFilter = (keyword, context) => {
  const platform = firstMatch(keyword, PLATFORM_TERMS);
  if (!platform) return PASS;

  const hasAnchor = hasAnyAnchor(keyword, qualifyingAnchors(context.anchors));
  const hasIntent = !!firstMatch(keyword, context.anchors.bookIntent);
  if (hasAnchor && hasIntent) {
    return { verdict: "pause", code: "PLATFORM_NOISE", reason: `platform term "${platform}" with book intent` };
  }
  return { verdict: "reject", code: "PLATFORM_NOISE", reason: `platform/marketplace noise: "${platform}"` };
};

// --- 3h. Author-surname disambiguation (§5.2) -------------------------------

/**
 * "[first] [last] mcallister book series" is autocomplete dragging in an
 * unrelated author who shares a surname with a series character or comp.
 * The captured name is checked against the book's actual author and its
 * approved comp-author allowlist (lib/manualCompetitors.ts); anything else
 * is a different person entirely and is dropped.
 */
export const authorDisambiguationFilter: KeywordFilter = (keyword, context) => {
  const match = keyword.match(AUTHOR_DISAMBIGUATION_PATTERN);
  if (!match) return PASS;

  const name = match[1];
  const surname = name.split(" ")[1];
  const actualAuthor = context.actualAuthor ?? "";

  // Only a name-shaped phrase whose surname is one this book already knows
  // about (the real author, or a comp/character surname among the anchors)
  // is a candidate for disambiguation at all — this keeps generic genre
  // phrases like "police procedural books" out of the filter entirely.
  const knownSurnames = new Set(
    [actualAuthor, ...context.anchors.comps, ...context.anchors.bookSpecific]
      .map((known) => known.trim().toLowerCase().split(" ").pop())
      .filter((token): token is string => !!token)
  );
  if (!knownSurnames.has(surname)) return PASS;

  if (isApprovedAuthor(name, actualAuthor, context.asin)) return PASS;

  return { verdict: "reject", code: "AUTHOR_DISAMBIGUATION", reason: `"${name}" is not this book's author or an approved comp` };
};

// --- 4. Review n-gram quality ---------------------------------------------

/**
 * Raw n-grams off review prose are not search queries. Readers write "his
 * team was put together"; nobody types it. Applies only to the review
 * source — the same phrase arriving from the blurb or a category is judged
 * by its own filter.
 *
 * The better generation strategy (comparable-author mentions and
 * sentiment+genre pairs rather than raw n-grams) lives in
 * lib/reviewMining.ts; this is the backstop.
 */
export const reviewFragmentFilter: KeywordFilter = (keyword, context, sources) => {
  if (!sources.includes("review-language")) return PASS;

  const fragment = firstMatch(keyword, REVIEW_FILLER_FRAGMENTS);
  if (fragment) return { verdict: "reject", reason: `review filler: "${fragment}"` };

  const tokens = words(keyword);
  if (WEAK_CONNECTORS.includes(tokens[0]) || WEAK_CONNECTORS.includes(tokens[tokens.length - 1])) {
    return { verdict: "reject", reason: "starts or ends on a connector" };
  }
  if (tokens.some((token) => /^\d+$/.test(token))) {
    return { verdict: "reject", reason: "bare numeral from review prose" };
  }
  if (tokens.length < 3) {
    return { verdict: "reject", reason: "review fragment shorter than 3 words" };
  }
  const stopwordRatio = tokens.filter((token) => REVIEW_STOPWORDS.has(token)).length / tokens.length;
  if (stopwordRatio > 0.4) {
    return { verdict: "reject", reason: `${Math.round(stopwordRatio * 100)}% stopwords` };
  }
  if (!hasAnyAnchor(keyword, qualifyingAnchors(context.anchors))) {
    return { verdict: "pause", reason: "reader phrasing with no genre/series anchor" };
  }

  return PASS;
};

// --- 5. Synonym expansion quality -----------------------------------------

// Both halves of the controlled genre map — its keys and every phrase they
// map onto — as one flat list, built once at module load. The map is a
// module constant, so rebuilding and re-flattening it for each synonym-
// sourced keyword rebuilt the same array hundreds of times per run.
const CONTROLLED_SYNONYM_TERMS = [
  ...Object.keys(ALLOWED_GENRE_SYNONYMS),
  ...Object.values(ALLOWED_GENRE_SYNONYMS).flat(),
];

/**
 * A general-purpose thesaurus answers "crime" with "law-breaking" and
 * "scottish" with "erse". Neither is a book search. Synonym-sourced
 * candidates have to come from the controlled genre map (or already touch
 * the book's own vocabulary) to survive.
 */
export const synonymQualityFilter: KeywordFilter = (keyword, context, sources) => {
  if (!sources.includes("synonym")) return PASS;

  const bad = firstMatch(keyword, withoutAnchoredTerms(BAD_SYNONYM_TERMS, context));
  if (bad) return { verdict: "reject", reason: `thesaurus artifact: "${bad}"` };

  const matchedSynonym = firstMatch(keyword, CONTROLLED_SYNONYM_TERMS);
  const matchedAnchor = hasAnyAnchor(keyword, qualifyingAnchors(context.anchors));
  if (!matchedSynonym && !matchedAnchor) {
    return { verdict: "reject", reason: "synonym outside the controlled genre map" };
  }

  // A bare genre noun plus a book-intent word ("suspense books") is plausible
  // but far too broad to switch on unreviewed.
  const remaining = words(keyword).filter((token) => !BOOK_INTENT_WORDS.includes(token));
  if (remaining.length === 1 && context.anchors.genre.includes(remaining[0])) {
    return { verdict: "pause", reason: "single broad genre term plus book intent" };
  }

  return PASS;
};

// --- 6. Description shaping -----------------------------------------------

/**
 * Blurb prose yields noun phrases worth keeping ("celtic symbols", "dr clio
 * wray") and verb fragments that are not queries ("killer leaves", "case
 * spirals"). Survivors are long-tail: specific enough for Phrase/Exact,
 * far too thin for Broad.
 */
export const descriptionShapeFilter: KeywordFilter = (keyword, context, sources) => {
  if (!sources.includes("book-description")) return PASS;

  const tokens = words(keyword);
  const verb = tokens.find((token) => DESCRIPTION_VERB_TOKENS.includes(token));
  if (verb) {
    return tokens.length <= 2
      ? { verdict: "reject", code: "FRAGMENT", reason: `verb fragment: "${verb}"` }
      : { verdict: "pause", code: "FRAGMENT", reason: `reads as a sentence fragment ("${verb}")` };
  }
  if (WEAK_CONNECTORS.includes(tokens[tokens.length - 1])) {
    return { verdict: "reject", code: "FRAGMENT", reason: "ends on a connector" };
  }

  // §5.6: a bare numeral that isn't a year ("5 dci mcneill") is a scraped
  // ordinal, not a query.
  const bareNumeral = tokens.find((token) => /^\d+$/.test(token) && !/^(19|20)\d{2}$/.test(token));
  if (bareNumeral) {
    return { verdict: "reject", code: "FRAGMENT", reason: `bare numeral, not a year: "${bareNumeral}"` };
  }

  // Review-language patterns ("gripping ... instalment") are review-speak,
  // not a search query.
  const hasReviewAdjective = !!firstMatch(keyword, REVIEW_SPEAK_ADJECTIVES);
  const hasReviewNoun = !!firstMatch(keyword, REVIEW_SPEAK_NOUNS);
  if (hasReviewAdjective && hasReviewNoun) {
    return { verdict: "reject", code: "FRAGMENT", reason: "review-language pattern (adjective + instalment/read)" };
  }

  // ≤2 meaningful tokens with no profile entity/genre anchor: a bare noun
  // pair off the blurb ("body marked", "tower block") reads nothing like a
  // search a reader would type.
  const meaningful = tokens.filter((token) => !REVIEW_STOPWORDS.has(token));
  if (meaningful.length <= 2 && !hasAnyAnchor(keyword, qualifyingAnchors(context.anchors))) {
    return { verdict: "reject", code: "FRAGMENT", reason: "short fragment with no profile entity or genre token" };
  }

  return { verdict: "pass", matchTypeCeiling: "phrase" };
};

// --- 7. Format availability -----------------------------------------------

/**
 * Only bid on a format the ASIN (or a sibling edition) actually has.
 * "jacqueline new hardcover" for a Kindle-only title sends readers to a page
 * that cannot sell them what they searched for.
 */
export const formatAvailabilityFilter: KeywordFilter = (keyword, context) => {
  for (const { format, pattern } of FORMAT_PATTERNS) {
    if (!pattern.test(keyword)) continue;
    if (!context.formats.includes(format)) {
      return { verdict: "reject", reason: `no ${format} edition on this listing` };
    }
  }
  if (KINDLE_UNLIMITED_PATTERN.test(keyword) && !context.isKindleUnlimited) {
    return { verdict: "reject", reason: "not enrolled in Kindle Unlimited" };
  }
  return PASS;
};

// --- 8. Seasonal & gift ---------------------------------------------------

const SEASONAL_INTENT_WORDS = [...BOOK_INTENT_WORDS, "gift", "gifts", "present", "presents"];

function inSeasonWindow(term: string, now: Date): boolean {
  const window = SEASON_WINDOWS[term];
  if (!window) return true;
  const today = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  // Windows that wrap the year end (winter) compare as a union of two ranges.
  return window.start <= window.end
    ? today >= window.start && today <= window.end
    : today >= window.start || today <= window.end;
}

/**
 * "christmas" and "halloween" are not book keywords; "crime thriller
 * christmas gift" is. A seasonal or gift term needs a buying-intent word and
 * a real anchor, and outside its season it is created paused rather than
 * spending budget in March.
 */
export const seasonalGiftFilter: KeywordFilter = (keyword, context) => {
  const seasonal = firstMatch(keyword, withoutAnchoredTerms(SEASONAL_TERMS, context));
  if (!seasonal) return PASS;

  const hasIntent = !!firstMatch(keyword, SEASONAL_INTENT_WORDS);
  if (!hasIntent) {
    return { verdict: "reject", reason: `seasonal term "${seasonal}" with no book/gift intent` };
  }

  const audienceReject = firstMatch(keyword, GIFT_AUDIENCE_REJECT_WORDS);
  if (audienceReject) {
    return { verdict: "reject", reason: `fan-of-a-place intent, not book intent ("${audienceReject}")` };
  }

  const anchor = hasAnyAnchor(keyword, qualifyingAnchors(context.anchors));
  if (!anchor) {
    return { verdict: "pause", reason: `seasonal phrase with no genre/author anchor ("${seasonal}")` };
  }

  const audiencePause = firstMatch(keyword, GIFT_AUDIENCE_PAUSE_WORDS);
  if (audiencePause) {
    return { verdict: "pause", reason: `gift-audience phrasing ("${audiencePause}")` };
  }

  if (!inSeasonWindow(seasonal, context.now)) {
    return { verdict: "pause", reason: `outside the ${seasonal} window` };
  }

  return PASS;
};

// --- 9. Single word -------------------------------------------------------

/**
 * One word is almost never a keyword: "scottish", "detective" and "heart"
 * match everything and convert on nothing. The exceptions are names — an
 * author or a distinctive series token ("mcneill") is a high-intent query on
 * its own — and a short pause list of place/genre nouns worth reviewing.
 */
export const singleWordFilter: KeywordFilter = (keyword, context) => {
  if (words(keyword).length !== 1) return PASS;

  const isName = context.anchors.bookSpecific.includes(keyword) || context.anchors.comps.includes(keyword);
  if (isName) return PASS;

  if (SINGLE_WORD_PAUSE_TERMS.includes(keyword)) {
    return { verdict: "pause", reason: "single distinctive genre term" };
  }
  // Place names pause (a reader searching "edinburgh" might be browsing);
  // the nationality adjective form never does.
  if (context.anchors.setting.includes(keyword) && !DEMONYM_TERMS.includes(keyword)) {
    return { verdict: "pause", reason: "single setting term" };
  }

  return { verdict: "reject", reason: "single-word keyword, too broad to bid on" };
};

// --- 10. Phrase shape (dangling modifiers) --------------------------------

/** Endings that leave the phrase without a head noun ("fast paced scottish"). */
const DANGLING_ENDINGS = [...DEMONYM_TERMS, "crime"];

/**
 * Completes a dangling modifier with the book's primary genre phrase rather
 * than dropping the keyword: "fast paced scottish" is a real reader
 * sentiment, it just needs the product noun on the end. Exported so the
 * buyer-intent generator can fix its own templates before they ever reach
 * the pipeline.
 */
export function endsOnBareModifier(keyword: string): boolean {
  const tokens = words(normalizeKeyword(keyword));
  return tokens.length >= 2 && DANGLING_ENDINGS.includes(tokens[tokens.length - 1]);
}

/**
 * Completes `keyword` when it ends on a bare modifier, and returns it
 * unchanged when it doesn't — the form a generator wants when templating.
 */
export function completeIfDangling(keyword: string, primaryGenrePhrase: string | undefined): string {
  if (!primaryGenrePhrase || !endsOnBareModifier(keyword)) return keyword;
  return completeDanglingModifier(keyword, primaryGenrePhrase) ?? keyword;
}

export function completeDanglingModifier(keyword: string, primaryGenrePhrase: string): string | undefined {
  if (!primaryGenrePhrase) return undefined;
  const tokens = words(keyword);
  const phraseTokens = words(primaryGenrePhrase);
  // Don't repeat a word the modifier already carries ("scottish crime" +
  // "crime thriller" → "scottish crime thriller").
  const additions = phraseTokens.filter((token) => !tokens.includes(token));
  if (additions.length === 0) return undefined;
  return [...tokens, ...additions].join(" ");
}

// Phrases allowed to end on a bare modifier: the curated list plus this
// book's own setting/genre vocabulary. Cached per context, and as a Set
// rather than an array, so neither the concatenation nor the linear scan
// over several hundred anchors repeats for every dangling keyword.
const MODIFIER_ALLOWLIST_CACHE = new WeakMap<FilterContext, Set<string>>();

function modifierAllowlist(context: FilterContext): Set<string> {
  let allowlist = MODIFIER_ALLOWLIST_CACHE.get(context);
  if (!allowlist) {
    allowlist = new Set([...ALLOWLISTED_MODIFIER_PHRASES, ...context.anchors.setting, ...context.anchors.genre]);
    MODIFIER_ALLOWLIST_CACHE.set(context, allowlist);
  }
  return allowlist;
}

export const phraseShapeFilter: KeywordFilter = (keyword, context) => {
  const tokens = words(keyword);
  if (tokens.length < 2) return PASS;

  const lastToken = tokens[tokens.length - 1];
  if (!DANGLING_ENDINGS.includes(lastToken)) return PASS;

  if (modifierAllowlist(context).has(keyword)) return PASS;

  const completed = completeDanglingModifier(keyword, context.anchors.primaryGenrePhrase);
  if (completed) {
    return { verdict: "pass", rewriteTo: completed, reason: "completed a dangling modifier" };
  }
  return { verdict: "reject", reason: `ends on a bare modifier ("${lastToken}")` };
};

// --- 11. Anchor relevance (final gate) ------------------------------------

/**
 * The gate every keyword has to clear: it must name something about *this*
 * book — its title/author/series/characters, its genre, its setting, or a
 * comparable author. Generic book-intent words never qualify on their own,
 * which is the whole difference between "english books" (out) and "scottish
 * crime books" (in).
 *
 * Sources whose text is lifted verbatim from the book's own metadata are
 * exempt: a phrase out of this book's blurb is relevant to this book by
 * construction, and gating it on a genre vocabulary would drop exactly the
 * distinctive long-tail the blurb exists to provide.
 */
export const anchorRelevanceFilter: KeywordFilter = (keyword, context, sources) => {
  if (sources.some((source) => SELF_ANCHORED_SOURCES.includes(source))) return PASS;

  const anchor = hasAnyAnchor(keyword, qualifyingAnchors(context.anchors));
  if (anchor) return PASS;

  const intent = firstMatch(keyword, context.anchors.bookIntent);
  return {
    verdict: "reject",
    reason: intent
      ? `only generic book intent ("${intent}"), nothing specific to this book`
      : "no relevance anchor for this book",
  };
};

// --- 12. Positive verdict (why it passed) ----------------------------------

/**
 * A "pass" used to carry no explanation at all — every reject/pause has a
 * `code`/`reason`, but a keyword that cleared every filter was a bare
 * `{ verdict: "pass" }`. This mirrors the negative side: on a pass, inspect
 * the same anchor-hit signals the pipeline already computed (comps,
 * author/series/title, genre) and record the strongest reason the keyword
 * survived, falling back to a generic code when nothing distinctive matched.
 * Checked strongest-first: a named comparable is a stronger signal than a
 * bare genre word, matching how anchorRelevanceFilter itself is the last and
 * weakest gate.
 */
function assignPassReason(keyword: string, context: FilterContext, sources: string[]): { code: ReasonCode; reason: string } {
  const comp = hasAnyAnchor(keyword, context.anchors.comps);
  if (comp) return { code: "COMP_TITLE_MATCH", reason: `names a comparable author/title: "${comp}"` };

  const series = context.seriesName ? normalizeKeyword(context.seriesName) : "";
  if (series && containsTerm(keyword, series)) {
    return { code: "SERIES_NAME_MATCH", reason: `names this book's series: "${context.seriesName}"` };
  }

  const author = context.actualAuthor ? normalizeKeyword(context.actualAuthor) : "";
  const authorSurname = author.split(" ").pop() ?? "";
  if (author && (containsTerm(keyword, author) || (authorSurname.length > 3 && containsTerm(keyword, authorSurname)))) {
    return { code: "AUTHOR_MATCH", reason: `names this book's author: "${context.actualAuthor}"` };
  }

  const title = context.title ? coreTitle(context.title) : undefined;
  const bookSpecific = (title && containsTerm(keyword, title)) ? title : hasAnyAnchor(keyword, context.anchors.bookSpecific);
  if (bookSpecific) {
    return { code: "BOOK_SPECIFIC_MATCH", reason: `matches a book-specific anchor (title/series/character): "${bookSpecific}"` };
  }

  const genre = hasAnyAnchor(keyword, context.anchors.genre);
  if (genre) return { code: "CORE_GENRE_MATCH", reason: `matches this book's core genre: "${genre}"` };

  if (sources.some((source) => SELF_ANCHORED_SOURCES.includes(source))) {
    return { code: "NO_DISQUALIFIER", reason: "lifted from this book's own metadata, no disqualifying signal" };
  }

  return { code: "NO_DISQUALIFIER", reason: "cleared every filter, no disqualifying signal found" };
}

/** The pipeline, in order. Each filter's name is stored on the keyword it stops. */
export const KEYWORD_FILTER_PIPELINE: Array<{ name: string; filter: KeywordFilter }> = [
  { name: "uiPollution", filter: uiPollutionFilter },
  { name: "languageMarket", filter: languageMarketFilter },
  { name: "offTopicEntity", filter: offTopicEntityFilter },
  { name: "physicalProduct", filter: physicalProductFilter },
  { name: "bookIntentGate", filter: bookIntentGateFilter },
  { name: "marketplaceBoilerplate", filter: marketplaceBoilerplateFilter },
  { name: "reviewFragment", filter: reviewFragmentFilter },
  { name: "synonymQuality", filter: synonymQualityFilter },
  { name: "subgenre", filter: subgenreFilter },
  { name: "toneNationality", filter: toneNationalityFilter },
  { name: "descriptionShape", filter: descriptionShapeFilter },
  { name: "formatAvailability", filter: formatAvailabilityFilter },
  { name: "audienceFormatPlatform", filter: audienceFormatPlatformFilter },
  { name: "seasonalGift", filter: seasonalGiftFilter },
  { name: "singleWord", filter: singleWordFilter },
  { name: "phraseShape", filter: phraseShapeFilter },
  { name: "titleCollision", filter: titleCollisionFilter },
  { name: "mediaTypeCollision", filter: mediaTypeCollisionFilter },
  { name: "platformNoise", filter: platformNoiseFilter },
  { name: "authorDisambiguation", filter: authorDisambiguationFilter },
  { name: "anchorRelevance", filter: anchorRelevanceFilter },
];

export interface FilteredKeyword {
  /** Normalised text, after any rewrite. */
  text: string;
  /** What the generator produced, kept so a rewrite is visible in the UI. */
  originalText: string;
  verdict: FilterVerdict;
  /** Which filter decided, when the verdict isn't a plain pass. */
  filter?: string;
  reason?: string;
  /** Machine-readable reason code (brief §5.10), set when the deciding filter has one. */
  code?: ReasonCode;
  rewritten: boolean;
  /** Set when the deciding source caps how broadly the keyword may run. */
  matchTypeCeiling?: MatchType;
}

function sourcesOf(keyword: FilterableKeyword): string[] {
  const sources = [...(keyword.sources ?? [])];
  if (keyword.source) sources.push(keyword.source);
  return sources;
}

/**
 * Runs one keyword through the pipeline. A rewrite restarts the remaining
 * filters against the rewritten text, so a completed phrase still has to
 * clear the relevance gate on its own merits.
 */
export function runKeywordFilters(keyword: FilterableKeyword, context: FilterContext): FilteredKeyword {
  const originalText = keyword.text;
  const sources = sourcesOf(keyword);
  let text = normalizeKeyword(originalText);
  let rewritten = false;
  let matchTypeCeiling: MatchType | undefined;

  if (!text) {
    return { text: "", originalText, verdict: "reject", filter: "normalise", reason: "empty after normalisation", rewritten: false };
  }

  for (const { name, filter } of KEYWORD_FILTER_PIPELINE) {
    const result = filter(text, context, sources);

    if (result.verdict !== "pass") {
      return { text, originalText, verdict: result.verdict, filter: name, reason: result.reason, code: result.code, rewritten, matchTypeCeiling };
    }
    if (result.rewriteTo) {
      text = normalizeKeyword(result.rewriteTo);
      rewritten = true;
    }
    if (result.matchTypeCeiling) {
      matchTypeCeiling = result.matchTypeCeiling;
    }
  }

  const { code, reason } = assignPassReason(text, context, sources);
  return { text, originalText, verdict: "pass", rewritten, matchTypeCeiling, code, reason };
}

export interface FilterRunSummary {
  /** Verdict counts across the batch. */
  byVerdict: Record<FilterVerdict, number>;
  /** Rejections/pauses per filter, for tuning the blocklists. */
  byFilter: Record<string, number>;
  /** Passes per positive code (COMP_TITLE_MATCH, CORE_GENRE_MATCH, …) — the pass-side mirror of byFilter. */
  byPassCode: Record<string, number>;
}

export interface FilterRunOutput {
  results: FilteredKeyword[];
  summary: FilterRunSummary;
}

/**
 * Runs a whole batch, deduping on the post-rewrite text (two dangling
 * modifiers can complete to the same phrase) and keeping the best verdict
 * when they collide.
 */
export function filterKeywords(keywords: FilterableKeyword[], context: FilterContext): FilterRunOutput {
  const byText = new Map<string, FilteredKeyword>();
  const summary: FilterRunSummary = {
    byVerdict: { pass: 0, pause: 0, reject: 0 },
    byFilter: {},
    byPassCode: {},
  };

  const rank: Record<FilterVerdict, number> = { pass: 2, pause: 1, reject: 0 };

  for (const keyword of keywords) {
    const result = runKeywordFilters(keyword, context);
    if (!result.text) continue;
    const existing = byText.get(result.text);
    if (existing && rank[existing.verdict] >= rank[result.verdict]) continue;
    byText.set(result.text, result);
  }

  const results = Array.from(byText.values());
  for (const result of results) {
    summary.byVerdict[result.verdict] += 1;
    if (result.filter) {
      summary.byFilter[result.filter] = (summary.byFilter[result.filter] ?? 0) + 1;
    }
    if (result.verdict === "pass" && result.code) {
      summary.byPassCode[result.code] = (summary.byPassCode[result.code] ?? 0) + 1;
    }
  }

  return { results, summary };
}

/** Book fields the pipeline needs beyond the anchors themselves. */
export interface FilterContextInput extends AnchorInput {
  marketplace: Marketplace;
  language?: string;
  formats: string[];
  isKindleUnlimited: boolean;
  hasTranslationEdition?: boolean;
  now?: Date;
}

/** One call from a stored snapshot to a ready-to-use pipeline context. */
export function buildFilterContext(input: FilterContextInput): FilterContext {
  return {
    anchors: buildBookAnchors(input),
    marketplace: input.marketplace,
    language: input.language,
    formats: input.formats,
    isKindleUnlimited: input.isKindleUnlimited,
    hasTranslationEdition: input.hasTranslationEdition,
    now: input.now ?? new Date(),
    actualAuthor: input.author,
    asin: input.asin,
    title: input.title,
    seriesName: input.seriesName,
  };
}

/**
 * Applies the pipeline to scored candidates, returning the survivors (with
 * any rewrite applied) alongside the paused and rejected rows so the caller
 * can persist all three. Candidate order — and therefore scoring order — is
 * preserved.
 */
export function applyFiltersToCandidates(
  candidates: KeywordCandidate[],
  context: FilterContext
): {
  passed: Array<KeywordCandidate & { matchTypeCeiling?: MatchType; reason?: string; code?: ReasonCode }>;
  paused: Array<KeywordCandidate & { filter?: string; reason?: string; code?: ReasonCode }>;
  rejected: Array<KeywordCandidate & { filter?: string; reason?: string; code?: ReasonCode }>;
  /** The raw per-keyword verdicts, for callers that need them (negative keyword building). */
  results: FilteredKeyword[];
  summary: FilterRunSummary;
} {
  const byText = new Map<string, KeywordCandidate>();
  for (const candidate of candidates) byText.set(normalizeKeyword(candidate.text), candidate);

  const { results, summary } = filterKeywords(candidates, context);

  const passed: Array<KeywordCandidate & { matchTypeCeiling?: MatchType; reason?: string; code?: ReasonCode }> = [];
  const paused: Array<KeywordCandidate & { filter?: string; reason?: string; code?: ReasonCode }> = [];
  const rejected: Array<KeywordCandidate & { filter?: string; reason?: string; code?: ReasonCode }> = [];

  for (const result of results) {
    const source = byText.get(normalizeKeyword(result.originalText)) ?? {
      text: result.text,
      sources: [],
    };
    const candidate: KeywordCandidate = { ...source, text: result.text };

    if (result.verdict === "pass") passed.push({ ...candidate, matchTypeCeiling: result.matchTypeCeiling, reason: result.reason, code: result.code });
    else if (result.verdict === "pause") paused.push({ ...candidate, filter: result.filter, reason: result.reason, code: result.code });
    else rejected.push({ ...candidate, filter: result.filter, reason: result.reason, code: result.code });
  }

  return { passed, paused, rejected, results, summary };
}
