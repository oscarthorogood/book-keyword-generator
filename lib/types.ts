export type MatchType = "broad" | "phrase" | "exact";

export type Marketplace = "US" | "UK" | "CA" | "DE" | "FR" | "IT" | "ES";

export interface GenerateRequest {
  asin: string;
  marketplace: Marketplace;
  campaignName: string;
  adGroupName: string;
  dailyBudget: number;
  startDate: string; // YYYY-MM-DD
  defaultBid: number;
  matchTypes: MatchType[];
}

export type KeywordSource =
  | "ads-api"
  | "autocomplete"
  | "comp-title"
  | "genre-metadata"
  | "buyer-intent";

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
