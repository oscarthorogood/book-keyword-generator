/**
 * Per-book relevance anchors — the vocabulary a keyword has to touch to be
 * worth bidding on for *this* book.
 *
 * Everything here is derived from the metadata captured when the book was
 * added (lib/bookSnapshot.ts); nothing is hardcoded per title. The filter
 * pipeline's final gate (lib/keywordFilters.ts#anchorRelevanceFilter) passes
 * a keyword only when it contains at least one anchor from
 * bookSpecific | genre | setting | comps. Generic book-intent words
 * ("books", "kindle", "read") never qualify a keyword on their own, which is
 * what separates "scottish crime books" (keep) from "english books" (drop).
 */

import { cleanTaxonomyTerms, genreFamilySearchTerms, genreFamilyThemeTerms, isCategoryNoise, type GenreFamily } from "./genre";
import {
  ALLOWED_GENRE_SYNONYMS,
  BOOK_INTENT_WORDS,
  DEMONYM_TERMS,
  UI_POLLUTION_TERMS,
} from "./keywordFilterConfig";
import { manualCompetitors } from "./manualCompetitors";

export interface BookAnchors {
  /** Title, author, series, character names — the things only this book is about. */
  bookSpecific: string[];
  /** Genre vocabulary from the category path and the detected genre families. */
  genre: string[];
  /** Places and nationalities the book is actually set in / about. */
  setting: string[];
  /** Comparable authors, series and titles. */
  comps: string[];
  /** Generic book-intent words. Only count when paired with one of the above. */
  bookIntent: string[];
  /** The genre phrase used to complete dangling modifiers ("fast paced scottish" → "… crime thriller"). */
  primaryGenrePhrase: string;
  /** Explicit book profile (brief §2) — subgenre/tone/nationality/format guardrails. Optional: hand-built anchors (tests, older callers) may omit it; use `profileOf()` to read it with defaults filled in. */
  profile?: BookProfile;
}

/**
 * The book profile the brief (§2) recommends as an explicit per-book input:
 * what subgenre/tone this book is (and isn't), what nationality it's about,
 * and what formats it's actually sold in. Everything here is supplied by
 * the caller rather than inferred — it's editorial judgement, not a scrape.
 */
export interface BookProfile {
  genreCore: string[];
  genreAdjacent: string[];
  genreDeny: string[];
  tone: string[];
  toneDeny: string[];
  nationality: string[];
  audience: string;
  formatsOffered: string[];
  formatsNotOffered: string[];
}

export interface AnchorInput {
  title?: string;
  author?: string;
  seriesName?: string;
  description?: string;
  genreTerms: string[];
  genreFamilies: GenreFamily[];
  categoryPath: string[];
  categories?: string[];
  goodreadsTags?: string[];
  competitors: Array<{ title?: string; author?: string }>;
  compTitles: string[];
  reviewSnippets?: string[];
  keyTropes?: string[];
  /** The book's own ASIN, used to pull its manually curated comps (lib/manualCompetitors.ts) into the anchor set. */
  asin?: string;
  /** Explicit book profile (brief §2). Optional per book; empty lists are a valid, if permissive, profile. */
  bookProfile?: Partial<BookProfile>;
}

function defaultBookProfile(input: Partial<BookProfile> | undefined): BookProfile {
  return {
    genreCore: input?.genreCore ?? [],
    genreAdjacent: input?.genreAdjacent ?? [],
    genreDeny: input?.genreDeny ?? [],
    tone: input?.tone ?? [],
    toneDeny: input?.toneDeny ?? [],
    nationality: input?.nationality ?? [],
    audience: input?.audience ?? "adult",
    formatsOffered: input?.formatsOffered ?? [],
    formatsNotOffered: input?.formatsNotOffered ?? [],
  };
}

/**
 * Genre words readers actually type. Used to pick the genre words *out of*
 * this book's taxonomy strings — not to assign a genre, which lib/genre.ts
 * already does from the book's own placement.
 */
const GENRE_LEXICON = [
  "crime", "mystery", "thriller", "suspense", "detective", "noir", "whodunit",
  "sleuth", "procedural", "murder", "espionage", "spy", "romance", "romantasy",
  "fantasy", "horror", "gothic", "dystopian", "cyberpunk", "steampunk",
  "science fiction", "sci-fi", "historical", "literary", "contemporary",
  "young adult", "middle grade", "picture book", "memoir", "biography",
  "autobiography", "true crime", "cozy", "cosy", "paranormal", "supernatural",
  "adventure", "western", "saga", "poetry", "graphic novel", "manga", "comics",
  "self help", "business", "leadership", "cookbook", "recipes", "travel",
  "history", "science", "nature", "religion", "spirituality", "health",
  "fitness", "psychological", "domestic", "legal", "medical", "military",
  "police", "forensic", "amateur sleuth", "hard boiled", "hardboiled",
];

/**
 * Place vocabulary worth treating as a setting anchor when the book's own
 * metadata mentions it. Deliberately a gazetteer of *settings*, not every
 * place name in the world: an anchor list that matched any capitalised place
 * would let autocomplete drift back in through the front door.
 */
const SETTING_GAZETTEER = [
  "scotland", "scottish", "edinburgh", "glasgow", "highlands", "aberdeen", "dundee",
  "england", "english", "london", "yorkshire", "cornwall", "cornish", "manchester",
  "liverpool", "brighton", "oxford", "cambridge", "lake district", "cotswolds",
  "wales", "welsh", "cardiff", "ireland", "irish", "dublin", "belfast",
  "britain", "british", "uk", "united kingdom", "isle of skye", "shetland", "orkney",
  "france", "french", "paris", "provence", "italy", "italian", "rome", "tuscany",
  "spain", "spanish", "barcelona", "germany", "german", "berlin",
  "norway", "sweden", "denmark", "iceland", "finland", "nordic", "scandinavian",
  "new york", "boston", "chicago", "los angeles", "california", "texas", "florida",
  "alaska", "appalachian", "deep south", "midwest", "new england", "canada",
  "australia", "australian", "new zealand", "japan", "japanese", "tokyo",
  "india", "africa", "small town", "coastal", "island", "village", "seaside",
];

/** Honorifics and rank prefixes that mark a character name in a blurb ("DCI McNeill", "Dr Clio Wray"). */
const NAME_TITLES = [
  "dci", "di", "ds", "dc", "dr", "detective", "inspector", "sergeant", "professor",
  "father", "sister", "captain", "commander", "chief", "agent", "officer", "lord",
  "lady", "mr", "mrs", "ms", "miss", "sir", "judge", "sheriff", "colonel", "major",
];

/** Blurb words that are capitalised mid-sentence without being names. */
const NOT_A_NAME = new Set([
  "the", "a", "an", "and", "but", "when", "then", "now", "but", "as", "if", "in",
  "on", "at", "for", "with", "from", "her", "his", "their", "they", "she", "he",
  "it", "this", "that", "there", "here", "what", "who", "why", "how", "one", "two",
  "three", "first", "second", "last", "new", "york", "book", "books", "kindle",
  "amazon", "praise", "reviews", "review", "bestselling", "bestseller", "author",
  "novel", "series", "perfect", "fans", "readers", "gripping", "unputdownable",
]);

function normalizeAnchor(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pushAnchor(target: Set<string>, value: string | undefined, minLength = 3) {
  if (!value) return;
  const normalized = normalizeAnchor(value);
  if (normalized.length < minLength) return;
  if (isCategoryNoise(normalized)) return;
  if (UI_POLLUTION_TERMS.some((term) => normalized === term)) return;
  target.add(normalized);
}

/**
 * Amazon titles carry subtitle/series furniture ("Scars of the Past: A
 * gripping Scottish crime thriller (DCI McNeill Book 1)"). The bare title is
 * the anchor; the rest is marketing copy that would anchor half the genre.
 */
export function coreTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  const withoutParens = title.replace(/\([^)]*\)/g, " ");
  const beforeSubtitle = withoutParens.split(/[:—–|]/)[0];
  const normalized = normalizeAnchor(beforeSubtitle);
  return normalized.length >= 3 ? normalized : undefined;
}

/**
 * Character and series names from the blurb: capitalised runs, and anything
 * following a rank/honorific. Rank-prefixed names are kept both with and
 * without the rank, so "dci mcneill" and "mcneill" both anchor.
 */
export function extractCharacterNames(description: string | undefined, limit = 12): string[] {
  if (!description) return [];
  const names = new Set<string>();

  // Case-insensitive on the rank ("DCI", "Dci", "dci") but not on the name:
  // a name is capitalised, and matching lowercase words here would turn half
  // the blurb into character names.
  const titlePattern = /\b([A-Za-z]{2,12})\.?\s+((?:[A-Z][\w'-]+\s*){1,3})/g;
  for (const match of description.matchAll(titlePattern)) {
    const rank = normalizeAnchor(match[1]);
    if (!NAME_TITLES.includes(rank)) continue;
    const name = normalizeAnchor(match[2]);
    if (!name || NOT_A_NAME.has(name.split(" ")[0])) continue;
    names.add(`${rank} ${name}`.trim());
    names.add(name);
    const surname = name.split(" ").pop();
    if (surname && surname.length > 3) names.add(surname);
  }

  // Plain capitalised name runs ("Clio Wray tries to…"). The second letter
  // must be lowercase so an all-caps rank ("DCI Mac") isn't read as a name,
  // while an internal capital ("McNeill", "O'Brien") still is.
  for (const match of description.matchAll(/\b([A-Z][a-z][A-Za-z'’-]+)\s+([A-Z][a-z][A-Za-z'’-]+)\b/g)) {
    const first = normalizeAnchor(match[1]);
    const second = normalizeAnchor(match[2]);
    if (NOT_A_NAME.has(first) || NOT_A_NAME.has(second)) continue;
    names.add(`${first} ${second}`);
    if (second.length > 3) names.add(second);
  }

  return Array.from(names).slice(0, limit);
}

/** Author-name variants worth anchoring on: the full name and the surname. */
function authorAnchors(author: string | undefined): string[] {
  if (!author) return [];
  const normalized = normalizeAnchor(author);
  if (!normalized) return [];
  const parts = normalized.split(" ").filter(Boolean);
  const out = [normalized];
  const surname = parts[parts.length - 1];
  if (parts.length > 1 && surname.length > 3) out.push(surname);
  return out;
}

/** The genre words present in one taxonomy string, e.g. "Crime, Thriller & Mystery" → crime, thriller, mystery. */
function genreWordsIn(text: string): string[] {
  const normalized = normalizeAnchor(text);
  return GENRE_LEXICON.filter((term) => new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`).test(normalized));
}

/** Setting words present in one string, from the gazetteer above. */
function settingWordsIn(text: string): string[] {
  const normalized = normalizeAnchor(text);
  return SETTING_GAZETTEER.filter((place) =>
    new RegExp(`\\b${place.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`).test(normalized)
  );
}

/**
 * The genre phrase a dangling modifier gets completed with ("dark scottish"
 * → "dark scottish crime thriller"). Prefers a real two-word genre phrase
 * from the book's own vocabulary over a bare genre noun.
 */
function derivePrimaryGenrePhrase(genreTerms: string[], families: GenreFamily[]): string {
  const twoWord = genreTerms.find((term) => term.split(" ").length === 2 && genreWordsIn(term).length > 0);
  if (twoWord) return twoWord;
  const familyPhrase = genreFamilySearchTerms(families, 3).find((term) => term.split(" ").length === 2);
  if (familyPhrase) return familyPhrase;
  const single = genreTerms.find((term) => genreWordsIn(term).length > 0);
  if (single) return `${single} books`;
  return "books";
}

/**
 * Builds the anchor sets for one book. Called at generation time from the
 * stored snapshot, so anchors always reflect the metadata the keywords were
 * generated from.
 */
export function buildBookAnchors(input: AnchorInput): BookAnchors {
  const bookSpecific = new Set<string>();
  const genre = new Set<string>();
  const setting = new Set<string>();
  const comps = new Set<string>();

  // --- book-specific -------------------------------------------------------
  pushAnchor(bookSpecific, coreTitle(input.title));
  for (const variant of authorAnchors(input.author)) pushAnchor(bookSpecific, variant);
  pushAnchor(bookSpecific, input.seriesName);
  // Series names carry the protagonist ("DCI McNeill Crime Thrillers") — the
  // distinctive token in there anchors on its own.
  for (const token of normalizeAnchor(input.seriesName ?? "").split(" ")) {
    if (token.length > 4 && !GENRE_LEXICON.includes(token) && !BOOK_INTENT_WORDS.includes(token)) {
      pushAnchor(bookSpecific, token, 4);
    }
  }
  for (const name of extractCharacterNames(input.description)) pushAnchor(bookSpecific, name);

  // --- genre ---------------------------------------------------------------
  const taxonomyStrings = [
    ...input.genreTerms,
    ...input.categoryPath,
    ...(input.categories ?? []),
    ...(input.goodreadsTags ?? []),
    ...(input.keyTropes ?? []),
  ];
  for (const raw of taxonomyStrings) {
    for (const term of cleanTaxonomyTerms(raw)) {
      if (genreWordsIn(term).length > 0) pushAnchor(genre, term);
      for (const word of genreWordsIn(term)) pushAnchor(genre, word);
    }
  }
  for (const term of [...genreFamilySearchTerms(input.genreFamilies, 20), ...genreFamilyThemeTerms(input.genreFamilies)]) {
    pushAnchor(genre, term);
    // "suspense thriller" also anchors "suspense": the family vocabulary is
    // where a genre word the breadcrumb never spelled out comes from.
    for (const word of genreWordsIn(term)) pushAnchor(genre, word);
  }
  // A genre the book demonstrably belongs to also anchors the phrases the
  // controlled synonym map maps it onto ("thriller" → "page turner"), so a
  // legitimate synonym isn't rejected by the gate that follows it.
  for (const [key, values] of Object.entries(ALLOWED_GENRE_SYNONYMS)) {
    const present = Array.from(genre).some((anchor) => anchor === key || anchor.includes(key));
    if (!present) continue;
    for (const value of values) pushAnchor(genre, value);
  }

  // --- setting -------------------------------------------------------------
  const settingSources = [
    ...input.categoryPath,
    ...(input.categories ?? []),
    ...input.genreTerms,
    ...(input.goodreadsTags ?? []),
    input.title ?? "",
    input.description ?? "",
  ];
  const foundPlaces = new Set<string>();
  for (const source of settingSources) {
    for (const place of settingWordsIn(source)) foundPlaces.add(place);
  }
  for (const place of foundPlaces) {
    pushAnchor(setting, place);
    // "scottish" + "crime" is how readers search; the combination is a much
    // stronger anchor than either half, and it is what rescues "scottish
    // crime books" while "english books" still fails.
    for (const genreWord of Array.from(genre).filter((g) => g.split(" ").length === 1)) {
      pushAnchor(setting, `${place} ${genreWord}`);
    }
  }

  // --- comps ---------------------------------------------------------------
  for (const competitor of input.competitors) {
    for (const variant of authorAnchors(competitor.author)) pushAnchor(comps, variant, 4);
    pushAnchor(comps, coreTitle(competitor.title), 4);
  }
  for (const title of input.compTitles) pushAnchor(comps, coreTitle(title), 4);
  const manualEntry = input.asin ? manualCompetitors[input.asin] : undefined;
  if (manualEntry) {
    for (const author of manualEntry.authors) {
      for (const variant of authorAnchors(author.name)) pushAnchor(comps, variant, 4);
    }
    for (const title of manualEntry.titles) pushAnchor(comps, coreTitle(title), 4);
  }
  // Comparable authors readers name in reviews ("better than Ian Rankin") are
  // only trusted when the crawl already knows them as comps, so a stray
  // capitalised phrase in a review can't invent an anchor.
  const knownComps = new Set(comps);
  for (const snippet of input.reviewSnippets ?? []) {
    for (const match of snippet.matchAll(/\b([A-Z][a-z'’-]{2,})\s+([A-Z][a-z'’-]{2,})\b/g)) {
      const name = normalizeAnchor(`${match[1]} ${match[2]}`);
      if (knownComps.has(name)) comps.add(name);
    }
  }

  const primaryGenrePhrase = derivePrimaryGenrePhrase(
    Array.from(genre).sort((a, b) => b.split(" ").length - a.split(" ").length),
    input.genreFamilies
  );

  return {
    bookSpecific: Array.from(bookSpecific),
    genre: Array.from(genre),
    setting: Array.from(setting),
    comps: Array.from(comps),
    bookIntent: [...BOOK_INTENT_WORDS],
    primaryGenrePhrase,
    profile: defaultBookProfile(input.bookProfile),
  };
}

/** True when the keyword names a place/nationality the book has nothing to do with. */
export function isForeignDemonym(word: string, anchors: BookAnchors): boolean {
  if (!DEMONYM_TERMS.includes(word)) return false;
  return !anchors.setting.includes(word);
}

// One BookAnchors object is built per generate/filter run and then read by
// this function from a dozen-plus call sites across lib/keywordFilters.ts,
// once per keyword — up to BOOK_KEYWORD_MAX + BOOK_COMP_NAME_MAX times per
// run. Caching by object identity means the concatenated array is only
// built once per run; the WeakMap drops the entry once that anchors object
// is no longer referenced, so nothing outlives the request that built it.
const QUALIFYING_ANCHORS_CACHE = new WeakMap<BookAnchors, string[]>();

/** Every anchor that qualifies a keyword for relevance (i.e. excluding bookIntent). */
export function qualifyingAnchors(anchors: BookAnchors): string[] {
  const cached = QUALIFYING_ANCHORS_CACHE.get(anchors);
  if (cached) return cached;
  const combined = [...anchors.bookSpecific, ...anchors.genre, ...anchors.setting, ...anchors.comps];
  QUALIFYING_ANCHORS_CACHE.set(anchors, combined);
  return combined;
}

/** Reads `anchors.profile` with an empty (permissive) default filled in for hand-built anchors that omit it. */
export function profileOf(anchors: BookAnchors): BookProfile {
  return anchors.profile ?? defaultBookProfile(undefined);
}
