export type MatchType = "broad" | "phrase" | "exact";

/**
 * Match-type strategy (Phase 2.1) — determines which match types are included
 * in the campaign and how many rows are generated.
 *
 * - "phrase-only": Single match type (Phrase), 1/3 row count, lower cost
 * - "phrase-exact": Two match types (Phrase + Exact), 2/3 row count, moderate cost
 * - "all": All three match types (Broad + Phrase + Exact), 3x row count, highest cost
 */
export type MatchTypeStrategy = "phrase-only" | "phrase-exact" | "all";

export type Marketplace = "US" | "UK" | "CA" | "DE" | "FR" | "IT" | "ES";

/**
 * Everything the naming convention needs to build
 * `PB_{initials}_{ASIN}_{Author}_{Series}_{Title}_{Country}_SPM_{variant}`.
 * Kept as a standalone interface so both the generate request and the
 * client-side name preview can share it.
 */
export interface CampaignIdentity {
  asin: string;
  marketplace: Marketplace;
  creatorInitials: string;
  authorName: string;
  bookTitle: string;
  seriesName?: string;
  /** Copy number for the "duplicate the winner" pattern (Copy 1, Copy 2, ...). */
  variant: number;
}

/** Per-book bid economics — see lib/bidding.ts. RRP is required to derive a max CPC. */
export interface BidEconomics {
  /** Recommended retail price, in the marketplace's local currency. */
  rrp: number;
  /** Target ACOS as a fraction, e.g. 0.35 for 35%. */
  targetAcos: number;
  /** Expected click-to-order conversion rate as a fraction, e.g. 0.08 for 8%. */
  estConversionRate: number;
}

export interface GenerateRequest extends CampaignIdentity {
  dailyBudget: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  seriesOrder?: number; // Book position in series (1-based)
  seriesTotal?: number; // Total books in series
  /** Match-type strategy (Phase 2.1): which match types to include. Default: "all" for backward compat. */
  matchTypeStrategy?: MatchTypeStrategy;
  matchTypes: MatchType[];
  bidEconomics?: BidEconomics;
  /** Manual fallback/override when bid economics aren't supplied. */
  defaultBid?: number;
  /** User-reviewed/pruned tags from the Autofill book profile — see lib/keywordMerge.ts#buildKnownTagCandidates. */
  knownTags?: string[];
  /** Which keyword sources to fold into the candidate pool. Omitted = every source (see ALL_KEYWORD_SOURCES in the generate route). */
  sources?: KeywordSource[];
  /** Which ad-group buckets to build into the Bulksheet. Omitted = all three. */
  keywordTypes?: KeywordGroupType[];
  /** Free-typed keywords the user explicitly wants included — bypass scoring/caps, guaranteed a slot. See buildManualKeywordCandidates. */
  manualKeywords?: string[];
  /** Which of the 20 keyword-intent categories to generate — see lib/keywordCategories.ts. Omitted = every category. */
  keywordCategories?: KeywordCategory[];
  /** User-supplied tropes/themes/settings (e.g. "grumpy billionaire", "enemies to lovers") — the app can't reliably scrape these, so they seed the character-trope/relationship-trope/plot-device/setting categories directly. See buildKeyTropeCandidates. */
  keyTropes?: string[];
}

export type KeywordSource =
  | "ads-api"
  | "autocomplete"
  | "comp-title"
  | "comp-name"
  | "genre-metadata"
  | "buyer-intent"
  | "book-content"
  | "google-autocomplete"
  | "youtube-autocomplete"
  | "duckduckgo-autocomplete"
  | "review-language"
  | "book-description"
  | "customer-qna"
  | "synonym"
  | "wikipedia"
  | "wikidata"
  | "loc-subjects"
  | "author-catalog"
  | "goodreads-tags"
  | "user-tag"
  | "manual"
  | "key-trope"
  | "amazon-recs"
  | "firecrawl";

/** The three ad-group buckets a Manual campaign splits into — see the generate route and README "Campaign structure". */
export type KeywordGroupType = "tropes" | "comp-names" | "product-targeting";

/**
 * The 20-category keyword-intent taxonomy — see lib/keywordCategories.ts for
 * the human-readable labels/hints and the generation logic behind each one.
 * Distinct from KeywordSource (which describes *where* a candidate came
 * from — a scrape, an API, a user); this describes *what kind of keyword it
 * is* semantically, and is only set on candidates the categorized generator
 * produces (buyer-intent/autocomplete/etc. candidates are left uncategorized
 * rather than guessed at).
 */
export type KeywordCategory =
  | "core-genre"
  | "sub-genre"
  | "competing-authors"
  | "comp-titles"
  | "series-names"
  | "character-tropes"
  | "relationship-tropes"
  | "plot-devices"
  | "setting-aesthetic"
  | "format"
  | "age-demographic"
  | "gift"
  | "problem-solving"
  | "skill-goal"
  | "mood-tone"
  | "award-bestseller"
  | "time-period"
  | "identity-cultural"
  | "synonym-alt"
  | "seasonal-holiday";

export interface KeywordCandidate {
  text: string;
  sources: KeywordSource[];
  suggestedBid?: number;
  /** Relevance/confidence score used to tier bids and order the output. Not written to the Bulksheet. */
  score?: number;
  /** Which of the 20 keyword-intent categories this came from, if the categorized generator produced it. */
  category?: KeywordCategory;
}

export interface BookMetadata {
  title?: string;
  author?: string;
  isbn10?: string;
  isbn13?: string;
  description?: string;
  categories: string[]; // Google Books categories
  subjects: string[]; // Open Library subjects
  commonTerms: string[]; // Google Books "Common terms and phrases" (content-derived, best-effort)
}

export interface ProductPageData {
  // Basic identifiers
  title?: string;
  author?: string;
  authorUrl?: string;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;

  // Author intelligence
  authorBio?: string;
  authorImage?: string;
  authorOtherBooks?: Array<{ title: string; asin?: string; categories?: string[] }>;
  illustrator?: string;
  narrator?: string; // for audiobooks

  // Pricing & deals
  price?: number;
  originalPrice?: number;
  discountPercentage?: number;
  primeEligible?: boolean;
  isDeal?: boolean;

  // Format & edition information
  format?: "Hardcover" | "Paperback" | "Kindle" | "Audiobook" | "Unknown";
  edition?: string;
  bindingType?: string;
  formatVariants?: Array<{ format: string; price?: number; asin?: string }>;

  // Images
  coverImageUrl?: string;
  authorImageUrl?: string;
  previewImages?: string[];
  customerImageCount?: number;
  customerVideoCount?: number;

  // Competitive & related products
  compTitles: string[];
  compDetails?: Array<{ asin: string; title: string; author?: string; rating?: number; reviewCount?: number }>;
  compAsins: string[];
  frequentlyBoughtTogether?: Array<{ asin: string; title: string }>;
  compareWithSimilar?: Array<{ asin: string; title: string }>;
  seriesBooks?: Array<{ position?: number; title: string; asin?: string }>;

  // Ratings & reviews
  rating?: number;
  reviewCount?: number;
  qaCount?: number;
  ratingDistribution?: { stars: number; count: number }[];
  verifiedPurchasePercentage?: number;

  // Categories & rankings
  categories: string[];
  categoryPath: string[];
  bestSellerRanks: { rank: number; category: string }[];
  allCategoryRanks?: Array<{ category: string; rank: number; browseNode?: string }>;
  amazonChoiceBadge?: boolean;
  bestsellerBadge?: boolean;

  // Content metadata
  reviewSnippets: string[];
  description?: string;
  bulletPoints: string[];
  tableOfContents?: string[];
  wordCount?: number;
  lexileLevel?: string;
  ageRange?: string;
  contentWarnings?: string[];
  readingLevel?: string;

  // Publication & physical
  publisher?: string;
  publicationDate?: string;
  copyrightYear?: number;
  firstPublishedDate?: string;
  pageCount?: number;
  language?: string;
  languages?: string[]; // multiple languages if applicable
  dimensions?: string;
  weight?: string;

  // Availability & status
  availability?: string;
  stockStatus?: "In Stock" | "Out of Stock" | "Pre-order" | "Unknown";
  deliveryOptions?: string[];
  hasLookInside?: boolean;
  isPreOrder?: boolean;
  preOrderDate?: string;

  // Format availability
  hasAudiobook?: boolean;
  hasKindle?: boolean;
  hasPhysical?: boolean;
  hasHardcover?: boolean;
  hasPaperback?: boolean;

  // Awards & recognition
  awards?: string[];
  awardNominations?: string[];
  goodreadsRating?: number;
  goodreadsRatingCount?: number;

  // Metadata
  /** HTTP status of the product page fetch, when one was made — for diagnosing scrape failures. */
  fetchStatus?: number;
  /** True when the response looked like an Amazon bot/CAPTCHA check rather than the real product page. */
  blocked?: boolean;
}

/** A comparable book discovered by the deep "also bought" crawl (lib/scrape.ts). */
export interface RelatedCompetitor {
  asin: string;
  author?: string;
  title?: string;
  /** Book quality metrics for scoring competitor keywords higher if from bestsellers. */
  rating?: number;
  reviewCount?: number;
  bestSellerRank?: number;
}

export interface RelatedCompetitorCrawl {
  categories: string[];
  competitors: RelatedCompetitor[];
  /** ASINs worth bidding on directly via product targeting (first + second hop). */
  productTargetAsins: string[];
  /** Review excerpts pooled across every crawled comp title, for cross-comp review-language mining. */
  reviewSnippets: string[];
}

export interface SourceStatus {
  source: KeywordSource | "product-page";
  ok: boolean;
  count?: number;
  error?: string;
}

/**
 * A comparable-title ASIN worth bidding on directly (Product Targeting),
 * as opposed to a text keyword. See lib/productTargets.ts.
 */
export interface ProductTargetCandidate {
  asin: string;
  sources: KeywordSource[];
  suggestedBid?: number;
}
