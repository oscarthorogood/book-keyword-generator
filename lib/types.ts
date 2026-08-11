export type MatchType = "broad" | "phrase" | "exact";

export type Marketplace = "US" | "UK" | "CA" | "DE" | "FR" | "IT" | "ES";

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
  | "firecrawl"
  /** The listing's own HTML metadata: <title>, meta keywords, URL slug, variation swatches. */
  | "listing-metadata"
  /** SerpApi Amazon Search — Amazon's own "related searches" for a seed term. */
  | "serpapi-related"
  /** SerpApi Amazon Search — competitor titles/authors ranking for a seed term. */
  | "serpapi-organic"
  /** SerpApi Amazon Autocomplete — the suggestions readers see while typing. */
  | "serpapi-autocomplete"
  /** Applied from the user's genre preset library (§3) rather than generated. */
  | "genre-preset";

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
  publisher?: string; // Open Library publisher
  publicationDate?: string; // Open Library publication date
  pageCount?: number; // Open Library page count
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
  /**
   * Formats confirmed present on the ASIN or its sibling editions, read from
   * the format swatch strip — the has* flags above come from a page-wide text
   * search and report almost every format on almost every page, so they must
   * not be used to decide whether a format keyword is legitimate.
   */
  availableFormats?: string[];
  isKindleUnlimited?: boolean;

  // HTML-level metadata (lib/listingMetadata.ts)
  /** The <title> tag — often a cleaner form of the product title. */
  htmlTitle?: string;
  /** Amazon's own <meta name="keywords"> terms, when present. */
  metaKeywords?: string[];
  metaDescription?: string;
  /** Human-readable URL segment before /dp/ — a canonical keyword phrase. */
  urlSlug?: string;
  /** Byline/publisher brand, for brand-targeting campaigns. */
  brand?: string;
  /** Variation swatch labels (size, colour, pack count, style). */
  variations?: string[];
  /** Parsed JSON-LD blocks from the page. */
  structuredData?: Array<Record<string, unknown>>;
  /** Per-field extraction outcome, for tracking selector drift. */
  extractionFieldsFound?: string[];
  extractionFieldsMissing?: string[];

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

