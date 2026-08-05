export type MatchType = "broad" | "phrase" | "exact";

export type Marketplace = "US" | "UK" | "CA" | "DE" | "FR" | "IT" | "ES";

/**
 * SPA = Sponsored Products Auto (Amazon-targeted discovery campaign).
 * SPM = Sponsored Products Manual (keyword/product-targeted harvest campaign).
 * See lib/naming.ts — this is also the token baked into the campaign name so
 * downstream tooling can tell the two apart by string-splitting alone.
 */
export type CampaignType = "SPA" | "SPM";

/**
 * Everything the naming convention needs to build
 * `PB_{initials}_{ASIN}_{Author}_{Series}_{Title}_{Country}_{SPA|SPM}_{variant}`.
 * Kept as a standalone interface so both the generate and harvest requests
 * (and the client-side name preview) can share it.
 */
export interface CampaignIdentity {
  asin: string;
  marketplace: Marketplace;
  campaignType: CampaignType;
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
}

export type KeywordSource =
  | "ads-api"
  | "autocomplete"
  | "comp-title"
  | "genre-metadata"
  | "buyer-intent"
  | "book-content"
  | "google-autocomplete"
  | "harvest";

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
  compTitles: string[]; // "customers also bought" style titles
  categories: string[]; // browse node / bestseller category text
  compAsins: string[]; // ASINs of "customers also bought" titles, for one-hop category lookup
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

// --- Harvesting (search term report -> promote/negate) ---------------------

/** One row of an Amazon Sponsored Products Search Term report, loosely typed to survive column drift. */
export interface SearchTermRow {
  searchTerm: string;
  /** Auto-targeting clause the impression came from, e.g. close-match/loose-match/substitutes/complements. Blank for Manual campaigns. */
  targeting?: string;
  matchType?: string;
  impressions: number;
  clicks: number;
  spend: number;
  orders: number;
  sales: number;
}

export type HarvestVerdict =
  | "promote" // convert to an exact-match keyword (or product target, for ASIN terms)
  | "negate" // spent without converting -> negative exact keyword
  | "monitor" // some signal, not enough yet either way
  | "low-impressions" // too little data to act on
  | "junk"; // garbled/bot query or scraped-page artifact, dropped entirely

export interface HarvestDecision {
  row: SearchTermRow;
  verdict: HarvestVerdict;
  /** True when the term is a bare ASIN and should route to product targeting instead of a keyword row. */
  isAsin: boolean;
  suggestedBid?: number;
}

export interface HarvestSummary {
  promoted: number;
  negated: number;
  monitored: number;
  lowImpressions: number;
  junk: number;
  total: number;
}
