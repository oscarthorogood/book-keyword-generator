export type MatchType = "broad" | "phrase" | "exact";

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
  | "key-trope";

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
  title?: string;
  author?: string;
  authorUrl?: string; // absolute URL to the author's Amazon page, for author-catalog lookup
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  /** Best-effort list price scrape, for prefilling the RRP field — not guaranteed to be the print RRP specifically. */
  price?: number;
  /** Book cover image URL */
  coverImageUrl?: string;
  compTitles: string[]; // "customers also bought" style titles
  /** Detailed competitor info for "customers also bought" with ratings */
  compDetails?: Array<{ asin: string; title: string; author?: string; rating?: number; reviewCount?: number }>;
  /** Q&A count for the book */
  qaCount?: number;
  /** Availability status (e.g., "In Stock", "Usually ships within 1-2 weeks") */
  availability?: string;
  categories: string[]; // browse node / bestseller category text (flat, deduped)
  /** Ordered breadcrumb trail (e.g. ["Books", "Mystery, Thriller & Suspense", "Cozy", "Culinary"]) — genre/subgenre in Amazon's own hierarchy order. */
  categoryPath: string[];
  /** Best Sellers Rank entries with the actual rank number, not just the category name. */
  bestSellerRanks: { rank: number; category: string }[];
  compAsins: string[]; // ASINs of "customers also bought" titles, for the deep competitor crawl
  reviewSnippets: string[]; // top-review excerpt text embedded on the page, for review-language mining
  description?: string; // publisher/author blurb, for comp-mention + description mining
  bulletPoints: string[]; // Amazon's "About this item" feature bullets
  /** Customer rating (e.g. 4.5 out of 5) */
  rating?: number;
  /** Number of customer reviews/ratings */
  reviewCount?: number;
  /** Page count for printed books */
  pageCount?: number;
  /** Publisher name */
  publisher?: string;
  /** Publication/release date */
  publicationDate?: string;
  /** Language(s) */
  language?: string;
  /** Product dimensions or weight */
  dimensions?: string;
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
  source: KeywordSource | "product-page" | "google-books" | "open-library";
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
