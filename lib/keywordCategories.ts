import { isUsableKeyword, normalize } from "./keywordMerge";
import { KeywordCandidate, KeywordCategory, KeywordSource, RelatedCompetitor } from "./types";

/**
 * The 20-category keyword-intent taxonomy layered on top of the existing
 * source pipeline (lib/keywordMerge.ts). A KeywordSource describes *where* a
 * candidate came from (a scrape, an API, a user); a KeywordCategory
 * describes *what kind of keyword it is* — genre, trope, mood, gift-intent,
 * etc. Most categories here reuse data the generate route already fetched
 * (categoryPath, comp titles/authors, description) rather than making new
 * calls; a few (character/relationship tropes, plot devices, setting) lean
 * on the user-supplied `keyTropes` field since the app has no reliable way
 * to scrape "grumpy billionaire" or "enemies to lovers" for a given book.
 */
export const KEYWORD_CATEGORY_META: { value: KeywordCategory; label: string; hint: string }[] = [
  { value: "core-genre", label: "Core Genre", hint: 'Broad primary classification, e.g. "science fiction", "thriller"' },
  { value: "sub-genre", label: "Micro-Niche Sub-Genre", hint: 'Specific, lower-competition classifications, e.g. "cyberpunk sci-fi"' },
  { value: "competing-authors", label: "Competing Author Names", hint: "Established authors writing in your niche" },
  { value: "comp-titles", label: "Comparable Book Titles", hint: "Popular or classic titles like yours" },
  { value: "series-names", label: "Famous Book Series Names", hint: 'Multi-book universe names, e.g. "Dune saga"' },
  { value: "character-tropes", label: "Main Character Tropes", hint: 'Protagonist archetypes, e.g. "grumpy billionaire"' },
  { value: "relationship-tropes", label: "Core Relationship Tropes", hint: 'Character dynamics, e.g. "enemies to lovers"' },
  { value: "plot-devices", label: "Specific Plot Devices", hint: 'Narrative mechanics, e.g. "time travel", "unreliable narrator"' },
  { value: "setting-aesthetic", label: "Setting & Aesthetic", hint: 'Time, place, or atmosphere, e.g. "dark academia"' },
  { value: "format", label: "Book Format", hint: 'Book type + medium, e.g. "kindle unlimited books", "audiobooks"' },
  { value: "age-demographic", label: "Target Age Demographic", hint: 'Reading level/maturity, e.g. "YA fantasy", "middle grade"' },
  { value: "gift", label: "Gift-Giver & Recipient", hint: "Shoppers buying for someone else" },
  { value: "problem-solving", label: "Problem-Solving (Non-Fiction)", hint: "The pain point the book resolves" },
  { value: "skill-goal", label: "Skill & Goal-Oriented (Non-Fiction)", hint: "Readers looking to learn an ability" },
  { value: "mood-tone", label: "Mood & Emotional Tone", hint: 'e.g. "cozy fantasy", "fast paced thriller"' },
  { value: "award-bestseller", label: "Award & Bestseller Intent", hint: "Critically acclaimed / highly validated" },
  { value: "time-period", label: "Time-Period & Historical Era", hint: 'e.g. "WWII historical fiction"' },
  { value: "identity-cultural", label: "Identity & Cultural Group", hint: "Cultural, diverse, or identity-focused themes" },
  { value: "synonym-alt", label: "Synonym & Alternative Phrasing", hint: "Different wording for the same concept" },
  { value: "seasonal-holiday", label: "Seasonal & Holiday", hint: 'e.g. "beach reads", "christmas cozy mystery"' },
];

export const ALL_KEYWORD_CATEGORIES: KeywordCategory[] = KEYWORD_CATEGORY_META.map((c) => c.value);

// ---- Curated, small dictionaries used only to *classify* real scraped/typed
// text (never to fabricate a claim about the book) ----
const CHARACTER_TROPE_TERMS = [
  "grumpy", "chosen one", "strong female lead", "anti hero", "antihero", "underdog",
  "reluctant hero", "morally gray", "loveable rogue", "girl boss", "billionaire",
  "bad boy", "cinnamon roll", "villain",
];
const RELATIONSHIP_TROPE_TERMS = [
  "enemies to lovers", "fake dating", "second chance romance", "second chance",
  "friends to lovers", "forbidden love", "love triangle", "slow burn romance",
  "marriage of convenience", "single dad", "single mom", "opposites attract",
  "found family", "workplace romance", "age gap",
];
const PLOT_DEVICE_TERMS = [
  "time travel", "unreliable narrator", "locked room mystery", "locked room",
  "plot twist", "dual timeline", "multiple povs", "amnesia", "whodunit", "heist",
  "revenge", "secret identity", "missing person", "cold case",
];
const SETTING_AESTHETIC_TERMS = [
  "dark academia", "small town", "space opera", "victorian", "dystopian",
  "post apocalyptic", "regency", "gothic", "island", "manor house", "coastal",
  "cottagecore", "urban fantasy",
];
const ERA_TERMS = [
  "wwii", "world war ii", "world war 2", "victorian", "regency", "medieval",
  "ancient rome", "ancient greece", "roaring twenties", "1920s", "cold war",
  "civil war", "renaissance", "tudor",
];
const IDENTITY_TERMS = [
  "lgbtq", "lgbt", "gay", "queer", "african american", "black", "latina", "latino",
  "hispanic", "native american", "asian american", "jewish", "muslim", "own voices",
  "multicultural", "disability",
];
const AGE_DICT: { match: string; label: string }[] = [
  { match: "children's", label: "kids" },
  { match: "kids", label: "kids" },
  { match: "young adult", label: "YA" },
  { match: "teen", label: "YA" },
  { match: "middle grade", label: "middle grade" },
];
const MOOD_TERMS = [
  "cozy", "dark", "fast paced", "slow burn", "heartwarming", "gritty", "uplifting",
  "emotional", "gripping", "atmospheric", "feel good", "tearjerker",
];
const FORMAT_TERMS = ["kindle unlimited books", "audiobooks", "large print books", "ebook"];
const SEASONAL_TERMS = ["beach reads", "summer reads", "christmas", "halloween", "holiday reads", "cozy winter reads"];

// Non-fiction "pain point" / "how to" mining — same explicit-pattern approach
// as extractComparableMentions in lib/keywordMerge.ts, just aimed at a
// different signal in the same description/bullet text.
const PROBLEM_PATTERNS = [
  /how to ([^.,;\n]+)/gi,
  /helps you ([^.,;\n]+)/gi,
  /guide to ([^.,;\n]+)/gi,
  /shows you how to ([^.,;\n]+)/gi,
  /overcome ([^.,;\n]+)/gi,
  /stop ([^.,;\n]+)/gi,
  /cure ([^.,;\n]+)/gi,
];
const SKILL_PATTERNS = [
  /learn ([^.,;\n]+)/gi,
  /master ([^.,;\n]+)/gi,
  /beginner('s)? guide to ([^.,;\n]+)/gi,
  /step[- ]by[- ]step ([^.,;\n]+)/gi,
  /teaches you ([^.,;\n]+)/gi,
];

function extractPatternMatches(text: string, patterns: RegExp[]): string[] {
  const out = new Set<string>();
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const captured = match[match.length - 1];
      const normalized = normalize(captured);
      if (isUsableKeyword(normalized) && normalized.split(" ").length <= 6) out.add(normalized);
    }
  }
  return Array.from(out);
}

/** Best-effort trope/setting classification of real text (never invents a claim). */
export function classifyTropeCategory(text: string): KeywordCategory | undefined {
  const lower = text.toLowerCase();
  if (RELATIONSHIP_TROPE_TERMS.some((t) => lower.includes(t))) return "relationship-tropes";
  if (PLOT_DEVICE_TERMS.some((t) => lower.includes(t))) return "plot-devices";
  if (SETTING_AESTHETIC_TERMS.some((t) => lower.includes(t))) return "setting-aesthetic";
  if (CHARACTER_TROPE_TERMS.some((t) => lower.includes(t))) return "character-tropes";
  return undefined;
}

function classifyCategoryPathSegment(segment: string): KeywordCategory {
  const lower = segment.toLowerCase();
  if (ERA_TERMS.some((t) => lower.includes(t))) return "time-period";
  if (IDENTITY_TERMS.some((t) => lower.includes(t))) return "identity-cultural";
  return "sub-genre";
}

export interface CategoryContext {
  title: string;
  author: string;
  seriesName?: string;
  genreTerms: string[];
  categoryPath: string[];
  competitors: RelatedCompetitor[];
  compTitles: string[];
  description?: string;
  bulletPoints: string[];
  keyTropes: string[];
  goodreadsTags: string[];
  reviewLanguagePhrases: string[];
  enabledCategories: Set<KeywordCategory>;
}

interface Tagged {
  text: string;
  category: KeywordCategory;
  source: KeywordSource;
}

/**
 * Runs every category generator gated by ctx.enabledCategories, tagging each
 * result with its KeywordCategory so the results UI can show coverage.
 * Returned candidates still flow through the normal merge/score/cap
 * pipeline in the generate route (except keyTropes, which additionally get
 * a scoring boost — see the "key-trope" case in scoreAndTierBids).
 */
export function buildCategorizedKeywordCandidates(ctx: CategoryContext): KeywordCandidate[] {
  const has = (c: KeywordCategory) => ctx.enabledCategories.has(c);
  const out: Tagged[] = [];
  const push = (category: KeywordCategory, source: KeywordSource, texts: (string | undefined)[]) => {
    for (const raw of texts) {
      if (!raw) continue;
      const text = normalize(raw);
      if (!isUsableKeyword(text)) continue;
      out.push({ text, category, source });
    }
  };

  const topGenre = ctx.genreTerms[0];
  const currentYear = new Date().getFullYear();

  // 1. Core Genre — top-level breadcrumb segment(s) + already-extracted genre terms.
  if (has("core-genre")) {
    const topSegments = ctx.categoryPath.slice(1, 2); // skip the "Books" root
    push("core-genre", "genre-metadata", [...topSegments, ...ctx.genreTerms.slice(0, 3)]);
    if (topGenre) push("core-genre", "buyer-intent", [`${topGenre} books`]);
  }

  // 2. Micro-Niche Sub-Genre — deeper breadcrumb segments (more specific),
  // reclassified into time-period/identity-cultural first if they clearly
  // indicate one (see classifyCategoryPathSegment).
  if (ctx.categoryPath.length > 2) {
    for (const segment of ctx.categoryPath.slice(2)) {
      const category = classifyCategoryPathSegment(segment);
      if (has(category)) push(category, "genre-metadata", [segment]);
    }
  }

  // 3 & 4. Competing Author Names / Comparable Book Titles — the deep "also
  // bought" crawl gives author and title separately; the product page's own
  // carousel only gives titles.
  if (has("competing-authors")) {
    push("competing-authors", "comp-name", ctx.competitors.map((c) => c.author));
  }
  if (has("comp-titles")) {
    push("comp-titles", "comp-name", [...ctx.competitors.map((c) => c.title), ...ctx.compTitles]);
  }

  // 5. Famous Book Series Names — only the book's own series is knowable
  // without extra scraping (no data source for *other* popular series).
  if (has("series-names") && ctx.seriesName) {
    push("series-names", "buyer-intent", [
      `${ctx.seriesName} books in order`,
      `${ctx.seriesName} series`,
      `${ctx.seriesName} series in order`,
    ]);
  }

  // 6-9. Character/Relationship Tropes, Plot Devices, Setting & Aesthetic —
  // primarily the user-supplied keyTropes (high-trust, book-specific), plus
  // best-effort reclassification of Goodreads shelf tags and review-mined
  // phrases that happen to match a known trope/setting term.
  for (const trope of ctx.keyTropes) {
    const category = classifyTropeCategory(trope) ?? "character-tropes";
    if (has(category)) push(category, "key-trope", [trope]);
  }
  for (const tag of ctx.goodreadsTags) {
    const category = classifyTropeCategory(tag);
    if (category && has(category)) push(category, "goodreads-tags", [tag]);
  }
  for (const phrase of ctx.reviewLanguagePhrases) {
    const category = classifyTropeCategory(phrase);
    if (category && has(category)) push(category, "review-language", [phrase]);
  }

  // 10. Book Format — generic format phrases, plus title/author crossed with format.
  if (has("format")) {
    push("format", "buyer-intent", FORMAT_TERMS);
    if (topGenre) push("format", "buyer-intent", [`paperback ${topGenre}`, `${topGenre} audiobook`]);
  }

  // 11. Target Age Demographic — only generated when Amazon's own breadcrumb
  // actually says so (never guessed at from genre alone).
  if (has("age-demographic")) {
    const ageMatch = ctx.categoryPath
      .map((seg) => AGE_DICT.find((a) => seg.toLowerCase().includes(a.match)))
      .find((m) => m !== undefined);
    if (ageMatch && topGenre) {
      push("age-demographic", "genre-metadata", [`${ageMatch.label} ${topGenre}`, `${ageMatch.label} books`]);
    }
  }

  // 12. Gift-Giver & Recipient — generic shopper-intent templating off genre + author.
  if (has("gift") && topGenre) {
    push("gift", "buyer-intent", [
      `gifts for ${topGenre} readers`,
      `gifts for ${topGenre} lovers`,
      `gifts for ${topGenre} fans`,
    ]);
  }

  // 13 & 14. Problem-Solving / Skill & Goal (non-fiction) — mined from the
  // book's own description + bullets; comes up empty for fiction, by design.
  const fullText = [ctx.description, ...ctx.bulletPoints].filter((t): t is string => !!t).join(". ");
  if (fullText) {
    if (has("problem-solving")) push("problem-solving", "book-description", extractPatternMatches(fullText, PROBLEM_PATTERNS));
    if (has("skill-goal")) push("skill-goal", "book-description", extractPatternMatches(fullText, SKILL_PATTERNS));
  }

  // 15. Mood & Emotional Tone — fixed mood-adjective list crossed with genre.
  if (has("mood-tone") && topGenre) {
    push("mood-tone", "buyer-intent", MOOD_TERMS.map((m) => `${m} ${topGenre}`));
  }

  // 16. Award & Bestseller Intent.
  if (has("award-bestseller") && topGenre) {
    push("award-bestseller", "buyer-intent", [
      `award winning ${topGenre}`,
      `bestselling ${topGenre}`,
      `${topGenre} bestsellers ${currentYear}`,
      `must read ${topGenre}`,
    ]);
  }

  // 19. Synonym & Alternative Phrasing is populated in the generate route by
  // re-tagging the existing Datamuse synonym candidates (no new logic here —
  // see the "key-trope"/synonym wiring around buildCategorizedKeywordCandidates).

  // 20. Seasonal & Holiday.
  if (has("seasonal-holiday")) {
    push("seasonal-holiday", "buyer-intent", SEASONAL_TERMS);
    if (topGenre) push("seasonal-holiday", "buyer-intent", [`christmas ${topGenre}`, `halloween ${topGenre}`]);
  }

  return out.map(({ text, category, source }) => ({ text, sources: [source], category }));
}
