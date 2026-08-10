/**
 * Genre resolution — the single place that answers "what kind of book is
 * this?" from the metadata captured when the book was added.
 *
 * Everything downstream (autocomplete seeds, buyer-intent templating, the
 * category taxonomy, synonym expansion) used to hardcode a thriller/mystery
 * lexicon, so a romance or a cookbook came out of the pipeline with
 * "<title> thriller" and "crime fiction" keywords attached. Genre now comes
 * from the book's own Amazon breadcrumb / Google Books categories / Open
 * Library subjects / Goodreads shelves instead of being assumed.
 *
 * The second job here is cleaning. Amazon's breadcrumb is a *store* path
 * ("Kindle Store > Kindle eBooks > Mystery, Thriller & Suspense"), not a list
 * of search phrases: templating over it verbatim produced keywords like
 * "best kindle store books" and "kindle ebooks novel". CATEGORY_NOISE strips
 * the store scaffolding, and combined nodes get split into the individual
 * genre words shoppers actually type.
 */

export type GenreFamily =
  | "mystery-thriller"
  | "romance"
  | "fantasy"
  | "science-fiction"
  | "horror"
  | "historical"
  | "literary"
  | "young-adult"
  | "childrens"
  | "self-help"
  | "business"
  | "health-fitness"
  | "cooking"
  | "biography-memoir"
  | "history"
  | "religion-spirituality"
  | "science-nature"
  | "poetry"
  | "comics-graphic"
  | "travel";

interface GenreFamilyDefinition {
  family: GenreFamily;
  label: string;
  /** Substrings that identify this family in categories, subjects, shelves and blurbs. */
  signals: string[];
  /**
   * Search-shaped phrases real shoppers type for this family. Used to seed
   * autocomplete sweeps and as genre keyword candidates — deliberately
   * search phrases ("cozy mystery"), not taxonomy labels ("Mystery & Detective").
   */
  searchTerms: string[];
  /** Reader-vocabulary theme phrases worth keeping when they appear in the book's own copy. */
  themeTerms: string[];
}

const GENRE_FAMILIES: GenreFamilyDefinition[] = [
  {
    family: "mystery-thriller",
    label: "Mystery & Thriller",
    signals: [
      "mystery", "thriller", "suspense", "crime", "detective", "murder", "noir",
      "whodunit", "police procedural", "espionage", "spy",
    ],
    searchTerms: [
      "mystery thriller", "psychological thriller", "crime thriller", "murder mystery",
      "cozy mystery", "detective novel", "suspense thriller", "domestic thriller",
      "police procedural", "spy thriller",
    ],
    themeTerms: [
      "unreliable narrator", "plot twist", "twist ending", "locked room mystery",
      "cold case", "missing person", "serial killer", "amateur sleuth",
    ],
  },
  {
    family: "romance",
    label: "Romance",
    signals: ["romance", "romantic", "love story", "romcom", "rom-com", "erotica", "chick lit"],
    searchTerms: [
      "romance novel", "contemporary romance", "romantic comedy", "small town romance",
      "historical romance", "romantasy", "spicy romance", "clean romance",
    ],
    themeTerms: [
      "enemies to lovers", "friends to lovers", "second chance romance", "fake dating",
      "forced proximity", "slow burn romance", "grumpy sunshine", "marriage of convenience",
    ],
  },
  {
    family: "fantasy",
    label: "Fantasy",
    signals: ["fantasy", "magic", "dragons", "sword and sorcery", "mythology", "fae", "epic fantasy"],
    searchTerms: [
      "fantasy novel", "epic fantasy", "urban fantasy", "dark fantasy", "cozy fantasy",
      "high fantasy", "fantasy series", "magic school books",
    ],
    themeTerms: ["chosen one", "magic system", "hidden world", "prophecy", "found family"],
  },
  {
    family: "science-fiction",
    label: "Science Fiction",
    signals: ["science fiction", "sci-fi", "scifi", "dystopian", "space opera", "cyberpunk", "time travel"],
    searchTerms: [
      "science fiction novel", "space opera", "dystopian novel", "cyberpunk books",
      "hard science fiction", "post apocalyptic books", "time travel books",
    ],
    themeTerms: ["first contact", "artificial intelligence", "generation ship", "alternate reality"],
  },
  {
    family: "horror",
    label: "Horror",
    signals: ["horror", "ghost", "haunted", "supernatural", "occult", "vampire", "gothic"],
    searchTerms: [
      "horror novel", "supernatural horror", "gothic horror", "haunted house books",
      "psychological horror", "creepy books",
    ],
    themeTerms: ["haunted house", "possession", "small town horror", "folk horror"],
  },
  {
    family: "historical",
    label: "Historical Fiction",
    signals: ["historical fiction", "historical", "world war", "wwii", "regency", "victorian", "medieval"],
    searchTerms: [
      "historical fiction", "wwii historical fiction", "world war 2 fiction",
      "victorian era novel", "regency novel", "historical saga",
    ],
    themeTerms: ["dual timeline", "based on a true story", "wartime", "period drama"],
  },
  {
    family: "literary",
    label: "Literary Fiction",
    signals: ["literary fiction", "literary", "contemporary fiction", "women's fiction", "book club"],
    searchTerms: [
      "literary fiction", "book club fiction", "contemporary fiction",
      "character driven novel", "womens fiction",
    ],
    themeTerms: ["coming of age", "family saga", "multigenerational", "quiet novel"],
  },
  {
    family: "young-adult",
    label: "Young Adult",
    signals: ["young adult", "teen", "ya fiction", "coming of age"],
    searchTerms: ["young adult novel", "ya fantasy", "ya romance", "teen fiction", "ya books for girls"],
    themeTerms: ["coming of age", "first love", "high school"],
  },
  {
    family: "childrens",
    label: "Children's",
    signals: ["children's", "childrens", "picture book", "middle grade", "early reader", "bedtime"],
    searchTerms: [
      "childrens books", "picture books", "middle grade books", "bedtime stories",
      "early reader books", "chapter books",
    ],
    themeTerms: ["read aloud", "illustrated", "learning to read"],
  },
  {
    family: "self-help",
    label: "Self-Help",
    signals: ["self-help", "self help", "personal development", "motivational", "productivity", "mindfulness"],
    searchTerms: [
      "self help books", "personal development books", "productivity books",
      "mindset books", "habit books", "motivational books",
    ],
    themeTerms: ["step by step", "practical guide", "daily practice"],
  },
  {
    family: "business",
    label: "Business & Money",
    signals: ["business", "entrepreneur", "management", "leadership", "marketing", "investing", "finance"],
    searchTerms: [
      "business books", "leadership books", "entrepreneurship books", "marketing books",
      "personal finance books", "investing books",
    ],
    themeTerms: ["case studies", "frameworks", "playbook"],
  },
  {
    family: "health-fitness",
    label: "Health & Fitness",
    signals: ["health", "fitness", "diet", "nutrition", "wellness", "exercise", "weight loss"],
    searchTerms: [
      "health books", "fitness books", "nutrition books", "weight loss books",
      "wellness books", "healthy living books",
    ],
    themeTerms: ["meal plan", "workout plan", "science backed"],
  },
  {
    family: "cooking",
    label: "Cookbooks",
    signals: ["cookbook", "cooking", "recipes", "baking", "food & wine", "air fryer"],
    searchTerms: [
      "cookbook", "easy recipes cookbook", "baking cookbook", "air fryer cookbook",
      "beginner cookbook", "family recipes cookbook",
    ],
    themeTerms: ["quick recipes", "budget friendly", "meal prep"],
  },
  {
    family: "biography-memoir",
    label: "Biography & Memoir",
    signals: ["biography", "memoir", "autobiography", "true story", "biographies"],
    searchTerms: ["memoir books", "biography books", "autobiography", "true story books", "celebrity memoir"],
    themeTerms: ["inspiring true story", "personal journey"],
  },
  {
    family: "history",
    label: "History",
    signals: ["history", "military history", "ancient", "civil war", "world history"],
    searchTerms: ["history books", "military history books", "world war 2 history books", "ancient history books"],
    themeTerms: ["narrative history", "primary sources"],
  },
  {
    family: "religion-spirituality",
    label: "Religion & Spirituality",
    signals: ["religion", "spirituality", "christian", "bible", "faith", "buddhism", "islam", "devotional"],
    searchTerms: [
      "christian books", "devotional books", "bible study books", "spiritual books",
      "faith based books", "prayer books",
    ],
    themeTerms: ["daily devotional", "study guide"],
  },
  {
    family: "science-nature",
    label: "Science & Nature",
    signals: ["science", "nature", "physics", "biology", "astronomy", "environment", "mathematics"],
    searchTerms: ["popular science books", "nature books", "astronomy books", "science books for adults"],
    themeTerms: ["accessible explanation", "big ideas"],
  },
  {
    family: "poetry",
    label: "Poetry",
    signals: ["poetry", "poems", "verse"],
    searchTerms: ["poetry books", "modern poetry", "poetry collection", "love poems book"],
    themeTerms: ["collection", "illustrated poetry"],
  },
  {
    family: "comics-graphic",
    label: "Comics & Graphic Novels",
    signals: ["comics", "graphic novel", "manga", "manhwa"],
    searchTerms: ["graphic novels", "manga books", "comic books", "graphic novel series"],
    themeTerms: ["full color", "illustrated"],
  },
  {
    family: "travel",
    label: "Travel",
    signals: ["travel", "guidebook", "road trip", "adventure travel"],
    searchTerms: ["travel books", "travel guide books", "travel memoir"],
    themeTerms: ["itineraries", "off the beaten path"],
  },
];

/**
 * Amazon store scaffolding and merchandising labels that show up in the
 * breadcrumb / category list but are not genres. Templating over these is
 * where "best kindle store books" and "kindle ebooks novel" came from.
 */
const CATEGORY_NOISE = new Set([
  "books", "book", "kindle store", "kindle ebooks", "kindle ebook", "kindle books",
  "kindle unlimited", "audible books & originals", "audible audiobooks", "audiobooks",
  "audible", "ebooks", "ebook", "amazon", "amazon.com", "amazon.co.uk", "categories",
  "new releases", "new release", "best sellers", "bestsellers", "deals", "prime reading",
  "editors' picks", "editors picks", "featured categories", "all", "genre fiction",
  "subjects", "shop by category", "browse genres", "literature", "fiction", "nonfiction",
  "non-fiction", "general", "other", "textbooks", "used books", "digital music",
  "movers & shakers", "most wished for", "gift ideas", "top rated",
]);

/** Subject strings from Open Library/Goodreads that are cataloguing artifacts, not reader vocabulary. */
const SUBJECT_NOISE_PATTERN =
  /^(nyt|new york times|accessible book|protected daisy|in library|overdrive|large type|open library|internet archive|reading level|lending library|fiction in english|translations into|\d{4})\b/i;

/** Splits first, then cleans: the separators carry the structure, so stripping punctuation up front would fuse "Mystery & Detective" into one term. */
const TAXONOMY_SEPARATORS = /\s*(?:,|&|\/|>|--|\||\band\b)\s*/;

// A book is usually one or two things. Anything scoring far below the leading
// family is a passing mention (a comp title's genre, a word in the blurb),
// not what the book is.
const FAMILY_CONFIDENCE_RATIO = 0.5;
const MAX_GENRE_FAMILIES = 3;

function clean(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[-\s]+|[-\s]+$/g, "")
    .trim();
}

/**
 * Splits combined taxonomy nodes ("Mystery, Thriller & Suspense",
 * "Fiction / Mystery & Detective / Cozy") into the individual genre phrases
 * shoppers actually search for. Hyphenated and multi-word genres stay intact
 * — only the joining punctuation is a split point.
 */
function splitTaxonomyNode(raw: string): string[] {
  // Cataloguing junk is recognised on the raw string: splitting first would
  // turn "nyt:combined-print-and-e-book-fiction" into fragments that no
  // longer look like the artifact they are.
  if (SUBJECT_NOISE_PATTERN.test(raw.trim())) return [];

  return raw
    .split(TAXONOMY_SEPARATORS)
    .map(clean)
    .filter(Boolean);
}

/** True for Amazon store scaffolding and merchandising labels that aren't genres. */
export function isCategoryNoise(term: string): boolean {
  return CATEGORY_NOISE.has(term.trim().toLowerCase());
}

function isUsableGenreTerm(term: string): boolean {
  if (term.length < 3 || term.length > 40) return false;
  if (isCategoryNoise(term)) return false;
  if (SUBJECT_NOISE_PATTERN.test(term)) return false;
  if (/^\d+$/.test(term)) return false;
  // Fragments left over from an aggressive split ("-e-book-fiction").
  if (/^-|-$/.test(term)) return false;
  return true;
}

/**
 * Cleaned, individually usable genre phrases from one raw taxonomy string.
 * Shared with the category taxonomy generator so breadcrumb segments get the
 * same treatment everywhere instead of being templated on verbatim.
 */
export function cleanTaxonomyTerms(raw: string | undefined): string[] {
  if (!raw) return [];
  return splitTaxonomyNode(raw).filter(isUsableGenreTerm);
}

export interface GenreSignalInput {
  /** Amazon breadcrumb, most general first. */
  categoryPath?: string[];
  /** Other Amazon category strings (detail bullets, best-seller rank rows). */
  categories?: string[];
  bestSellerCategories?: string[];
  googleBooksCategories?: string[];
  openLibrarySubjects?: string[];
  goodreadsTags?: string[];
  wikidataGenres?: string[];
  wikipediaCategories?: string[];
  title?: string;
  description?: string;
  bulletPoints?: string[];
}

/**
 * Ranks the genre families the book belongs to, most confident first.
 * Weighted by source trust: Amazon's own category placement is worth more
 * than a word that happens to appear in the blurb.
 */
export function detectGenreFamilies(input: GenreSignalInput): GenreFamily[] {
  const weighted: Array<{ text: string; weight: number }> = [];
  const add = (values: string[] | undefined, weight: number) => {
    for (const value of values ?? []) {
      if (value) weighted.push({ text: value.toLowerCase(), weight });
    }
  };

  add(input.categoryPath, 4);
  add(input.bestSellerCategories, 4);
  add(input.categories, 3);
  add(input.googleBooksCategories, 3);
  add(input.wikidataGenres, 3);
  add(input.openLibrarySubjects, 2);
  add(input.goodreadsTags, 2);
  add(input.wikipediaCategories, 1);
  add(input.title ? [input.title] : undefined, 1);
  add(input.bulletPoints, 1);
  // The blurb mentions plenty of words in passing, so it is the weakest signal.
  add(input.description ? [input.description] : undefined, 1);

  const scores = new Map<GenreFamily, number>();
  for (const definition of GENRE_FAMILIES) {
    let score = 0;
    for (const { text, weight } of weighted) {
      for (const signal of definition.signals) {
        if (text.includes(signal)) {
          score += weight;
          break; // one hit per source string per family
        }
      }
    }
    if (score > 0) scores.set(definition.family, score);
  }

  const ranked = Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return [];

  // Only families with real support, not every family a stray word touched.
  // Each family contributes a dozen curated search phrases downstream, so a
  // single passing mention of "murder" in a romance blurb would otherwise add
  // "spy thriller" and "police procedural" to that book's keyword list.
  const topScore = ranked[0][1];
  return ranked
    .filter(([, score]) => score >= topScore * FAMILY_CONFIDENCE_RATIO)
    .slice(0, MAX_GENRE_FAMILIES)
    .map(([family]) => family);
}

function definitionFor(family: GenreFamily): GenreFamilyDefinition | undefined {
  return GENRE_FAMILIES.find((d) => d.family === family);
}

export function genreFamilyLabel(family: GenreFamily): string {
  return definitionFor(family)?.label ?? family;
}

/** Curated, search-shaped phrases for the detected families (top families first). */
export function genreFamilySearchTerms(families: GenreFamily[], limit = 20): string[] {
  const out: string[] = [];
  for (const family of families) {
    for (const term of definitionFor(family)?.searchTerms ?? []) {
      if (!out.includes(term)) out.push(term);
    }
  }
  return out.slice(0, limit);
}

/** Reader-vocabulary theme phrases for the detected families — only used to *recognise* phrases in real text. */
export function genreFamilyThemeTerms(families: GenreFamily[]): string[] {
  const out: string[] = [];
  for (const family of families) {
    for (const term of definitionFor(family)?.themeTerms ?? []) {
      if (!out.includes(term)) out.push(term);
    }
  }
  return out;
}

/**
 * The book's genre vocabulary, cleaned and ordered by how much the source can
 * be trusted to describe the book itself. This is what seeds every templated
 * keyword in the pipeline, so a wrong or noisy value here multiplies into
 * dozens of bad keywords — hence the aggressive noise filtering above.
 */
export function deriveGenreTerms(input: GenreSignalInput, limit = 25): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();

  const push = (raw: string | undefined) => {
    for (const term of cleanTaxonomyTerms(raw)) {
      if (seen.has(term)) continue;
      seen.add(term);
      ordered.push(term);
    }
  };

  // Amazon's own placement first, deepest (most specific) nodes before the
  // broad top-level ones: "cozy mystery" beats "mystery" as an ad keyword.
  for (const segment of [...(input.categoryPath ?? [])].reverse()) push(segment);
  for (const category of input.bestSellerCategories ?? []) push(category);
  for (const category of input.googleBooksCategories ?? []) push(category);
  for (const genre of input.wikidataGenres ?? []) push(genre);
  for (const category of input.categories ?? []) push(category);
  for (const subject of input.openLibrarySubjects ?? []) push(subject);
  for (const tag of input.goodreadsTags ?? []) push(tag);

  // Guarantee at least a usable genre vocabulary even when every taxonomy
  // source came back empty or got filtered away as store scaffolding.
  if (ordered.length === 0) {
    for (const term of genreFamilySearchTerms(detectGenreFamilies(input), 8)) {
      if (!seen.has(term)) {
        seen.add(term);
        ordered.push(term);
      }
    }
  }

  return ordered.slice(0, limit);
}

/**
 * Genre words for autocomplete seeding — a blend of the book's real category
 * vocabulary and the curated search phrases for its families. Replaces the
 * old hardcoded thriller/mystery/crime list that was applied to every book
 * regardless of what it was about.
 */
export function buildGenreSeedModifiers(genreTerms: string[], families: GenreFamily[], limit = 10): string[] {
  const out: string[] = [];
  const push = (term: string) => {
    const trimmed = term.trim();
    // Long genre phrases make useless autocomplete seeds once concatenated
    // with a title, so seeds stay short.
    if (trimmed && trimmed.split(" ").length <= 3 && !out.includes(trimmed)) out.push(trimmed);
  };

  for (const term of genreTerms) push(term);
  for (const term of genreFamilySearchTerms(families, limit)) push(term);

  return out.slice(0, limit);
}
