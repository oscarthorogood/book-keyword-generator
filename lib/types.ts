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
  | "review-language"
  | "book-description"
  | "synonym"
  | "goodreads-tags"
  | "user-tag";

export interface KeywordCandidate {
  text: string;
  sources: KeywordSource[];
  suggestedBid?: number;
  /** Relevance/confidence score used to tier bids and order the output. Not written to the Bulksheet. */
  score?: number;
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
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  /** Best-effort list price scrape, for prefilling the RRP field — not guaranteed to be the print RRP specifically. */
  price?: number;
  compTitles: string[]; // "customers also bought" style titles
  categories: string[]; // browse node / bestseller category text (flat, deduped)
  /** Ordered breadcrumb trail (e.g. ["Books", "Mystery, Thriller & Suspense", "Cozy", "Culinary"]) — genre/subgenre in Amazon's own hierarchy order. */
  categoryPath: string[];
  /** Best Sellers Rank entries with the actual rank number, not just the category name. */
  bestSellerRanks: { rank: number; category: string }[];
  compAsins: string[]; // ASINs of "customers also bought" titles, for the deep competitor crawl
  reviewSnippets: string[]; // top-review excerpt text embedded on the page, for review-language mining
  description?: string; // publisher/author blurb, for comp-mention + description mining
  bulletPoints: string[]; // Amazon's "About this item" feature bullets
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
