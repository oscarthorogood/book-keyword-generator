/**
 * SerpApi's Amazon APIs (https://serpapi.com/amazon-search-api,
 * /amazon-product-api) — the licensed way to read Amazon, and the app's
 * preferred source over scraping the product page directly.
 *
 * Three engines, three different jobs:
 *
 *   engine=amazon              search results: Amazon's own "related
 *                              searches" (direct keyword expansions), plus
 *                              the titles/authors/ASINs ranking for a term
 *   engine=amazon_autocomplete the search-bar suggestions readers see while
 *                              typing — high-intent, natural phrasing
 *   engine=amazon_product      one ASIN's title/description/about-item,
 *                              category placement, bought-together and
 *                              related products, review vocabulary
 *
 * Amazon CAPTCHAs product-page requests from cloud/datacenter IPs (see
 * lib/scrape.ts), which is the "ASIN autofill keeps failing" symptom —
 * SerpApi runs the fetch from its own infrastructure and returns structured
 * JSON, sidestepping that entirely. Optional: unset SERPAPI_API_KEY falls
 * straight back to the direct scrape.
 *
 * Every call is one search credit, so the snowball crawl below is bounded by
 * hop count *and* an explicit credit budget rather than being allowed to run
 * until it runs out of ASINs.
 */

import { parsePriceText } from "./priceText";
import type { Marketplace } from "./types";

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const FETCH_TIMEOUT_MS = 15000;

const MARKETPLACE_DOMAINS: Record<Marketplace, string> = {
  US: "amazon.com",
  UK: "amazon.co.uk",
  CA: "amazon.ca",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
};

/** Keyword behaviour differs per marketplace — related searches and competitors must reflect the market the ads run in. */
const MARKETPLACE_LANGUAGES: Record<Marketplace, string> = {
  US: "en_US",
  UK: "en_GB",
  CA: "en_CA",
  DE: "de_DE",
  FR: "fr_FR",
  IT: "it_IT",
  ES: "es_ES",
};

export interface SerpApiAmazonProduct {
  title?: string;
  author?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  description?: string;
  isbn10?: string;
  isbn13?: string;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  dimensions?: string;
  categoryPath?: string[];
  bulletPoints?: string[];
  coverImageUrl?: string;
  /** Co-purchase and substitute ASINs — more competitors to crawl, and product-targeting candidates. */
  relatedAsins?: string[];
  relatedTitles?: string[];
  /** Reader vocabulary from the reviews block, which often differs from the blurb. */
  reviewSnippets?: string[];
  formats?: string[];
}

/** One organic result, kept whole so competitor discovery gets an ASIN *and* its metadata from the same credit. */
export interface SerpApiOrganicProduct {
  asin: string;
  title?: string;
  author?: string;
  price?: number;
  /** 1-based position in the results list — the rank signal competitor scoring uses. */
  position: number;
}

export interface SerpApiAmazonSearch {
  /** Amazon's own keyword expansions for the query — the highest-value section for Broad/Phrase. */
  relatedSearches: string[];
  /** Competitor book titles ranking for the term, subtitle stripped. */
  organicTitles: string[];
  /** Author names from those results — exact-match keyword candidates. */
  organicAuthors: string[];
  /** ASINs for the product-targeting list and the snowball crawl. */
  asins: string[];
  /**
   * Organic results with their ASIN, title, author and rank together.
   * Competitor-ASIN generation reads this rather than `asins` alone, so a row
   * lands with title/author/price already filled in instead of needing a
   * separate product-page fetch per ASIN.
   */
  organicProducts: SerpApiOrganicProduct[];
  /** Titles/brands paying for the term — a proxy for its commercial value. */
  sponsoredTitles: string[];
}

export function isSerpApiConfigured(): boolean {
  return !!SERPAPI_API_KEY;
}

/**
 * SerpApi's responses are free-form JSON whose exact shape varies by engine,
 * marketplace and product type, so they're read as unknown and narrowed at
 * each access rather than asserted into a type the API never promised.
 */
type JsonRecord = Record<string, unknown>;

function rec(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** product_information is a key/value dict; keep only the string-valued entries. */
function stringRecord(value: unknown): Record<string, string> | undefined {
  const record = rec(value);
  if (!record) return undefined;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === "string") out[key] = entry;
  }
  return out;
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * One SerpApi call. Returns null on any failure — unset key, non-2xx, or a
 * response whose `search_metadata.status` reports an error — so callers can
 * degrade instead of special-casing.
 */
async function callSerpApi(params: Record<string, string>): Promise<JsonRecord | null> {
  if (!SERPAPI_API_KEY) return null;

  const query = new URLSearchParams({ ...params, api_key: SERPAPI_API_KEY });
  const label = `${params.engine} ${params.k ?? params.q ?? params.asin ?? ""}`.trim();

  try {
    const res = await fetchWithTimeout(`${SERPAPI_ENDPOINT}?${query.toString()}`);
    if (!res.ok) {
      // SerpApi explains a rejected request in the body (`{"error": "…"}`) —
      // a bare status told us a call was failing but never which parameter it
      // objected to, which is not enough to fix anything.
      const detail = await res.text().catch(() => "");
      console.error(`[serpApi] ${label} failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
      return null;
    }
    const data = rec(await res.json());
    if (!data) return null;

    const status = str(rec(data.search_metadata)?.status);
    const error = str(data.error);
    if (error || (status && status !== "Success")) {
      console.error(`[serpApi] ${label} returned ${status ?? "an error"}: ${error ?? "unknown"}`);
      return null;
    }
    return data;
  } catch (err) {
    console.error(`[serpApi] ${label} errored:`, err instanceof Error ? err.message : err);
    return null;
  }
}

function domainFor(marketplace: Marketplace): string {
  return MARKETPLACE_DOMAINS[marketplace] ?? MARKETPLACE_DOMAINS.US;
}

/** Pulls a numeric field out of "$12.99"-style strings. */


/** Amazon book titles carry a subtitle and series furniture; the part before the colon is the searchable title. */
export function cleanBookTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const withoutSeries = raw.replace(/\([^)]*\)/g, " ");
  const beforeSubtitle = withoutSeries.split(":")[0];
  const cleaned = beforeSubtitle.replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}

/** Amazon book bylines are usually "by Author Name Format" — this API's fields don't reliably separate them, so try a few shapes. */
function extractAuthor(product: JsonRecord): string | undefined {
  const author = str(product.author);
  if (author) return author;

  const authors = list(product.authors)
    .map((entry) => str(entry) ?? str(rec(entry)?.name))
    .filter((name): name is string => !!name);
  if (authors.length > 0) return authors.join(", ");

  return str(product.brand);
}

/** product_information is a free-form key/value dict whose exact keys vary by product type/marketplace. */
function extractFromProductInformation(raw: unknown) {
  const info = stringRecord(raw);
  if (!info) return {};
  const find = (...labels: string[]) => {
    for (const [key, value] of Object.entries(info)) {
      const lower = key.toLowerCase();
      if (labels.some((label) => lower.includes(label))) return value;
    }
    return undefined;
  };

  const isbn10 = find("isbn-10", "isbn10");
  const isbn13 = find("isbn-13", "isbn13");
  const pages = find("print length", "pages");
  const pageCount = pages ? parseInt(pages.match(/\d+/)?.[0] ?? "", 10) : undefined;

  return {
    isbn10,
    isbn13,
    publisher: find("publisher"),
    publicationDate: find("publication date", "publish date"),
    pageCount: Number.isFinite(pageCount) ? pageCount : undefined,
    language: find("language"),
    dimensions: find("dimensions", "item weight"),
  };
}

function asStringArray(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const record = entry as Record<string, unknown>;
        const candidate = record.title ?? record.name ?? record.query ?? record.value ?? record.snippet;
        return typeof candidate === "string" ? candidate : undefined;
      }
      return undefined;
    })
    .filter((entry): entry is string => !!entry && entry.trim().length > 0)
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .slice(0, limit);
}

function collectAsins(value: unknown, into: Set<string>): void {
  for (const entry of list(value)) {
    const asin = str(rec(entry)?.asin);
    if (asin && /^[A-Z0-9]{10}$/i.test(asin)) into.add(asin.toUpperCase());
  }
}

/**
 * Amazon Search (engine=amazon) — what readers search and who competes for
 * it. `related_searches` is the section worth the credit: those are keyword
 * expansions Amazon itself publishes for the term.
 */
export async function searchAmazonViaSerpApi(
  query: string,
  marketplace: Marketplace = "US"
): Promise<SerpApiAmazonSearch | null> {
  const data = await callSerpApi({
    engine: "amazon",
    amazon_domain: domainFor(marketplace),
    language: MARKETPLACE_LANGUAGES[marketplace] ?? "en_US",
    k: query,
  });
  if (!data) return null;

  const asins = new Set<string>();
  collectAsins(data.organic_results, asins);
  collectAsins(data.product_ads, asins);
  collectAsins(data.featured_products, asins);

  const organicTitles: string[] = [];
  const organicAuthors: string[] = [];
  const organicProducts: SerpApiOrganicProduct[] = [];
  list(data.organic_results)
    .slice(0, 15)
    .forEach((entry, index) => {
      const result = rec(entry);
      if (!result) return;
      const title = cleanBookTitle(str(result.title));
      if (title) organicTitles.push(title);
      const author = extractAuthor(result);
      if (author) organicAuthors.push(author.replace(/\s+/g, " ").trim());

      const asin = str(result.asin);
      if (asin && /^[A-Z0-9]{10}$/i.test(asin)) {
        const price = rec(result.price);
        organicProducts.push({
          asin: asin.toUpperCase(),
          // The full title, not the subtitle-stripped keyword form — this is
          // metadata for a competitor row, not a keyword candidate.
          title: str(result.title),
          author: author?.replace(/\s+/g, " ").trim(),
          price: parsePriceText(price?.value ?? price?.raw ?? result.price ?? result.extracted_price),
          position: num(result.position) ?? index + 1,
        });
      }
    });

  return {
    relatedSearches: asStringArray(data.related_searches, 25),
    organicTitles,
    organicAuthors,
    asins: Array.from(asins),
    organicProducts,
    sponsoredTitles: [
      ...asStringArray(data.sponsored_brands, 10),
      ...asStringArray(data.product_ads, 10),
    ],
  };
}

/**
 * Amazon Autocomplete (engine=amazon_autocomplete) — the suggestions readers
 * see as they type, i.e. queries Amazon knows are actually being made.
 */
export async function getSerpApiAmazonAutocomplete(
  seed: string,
  marketplace: Marketplace = "US"
): Promise<string[]> {
  const data = await callSerpApi({
    engine: "amazon_autocomplete",
    amazon_domain: domainFor(marketplace),
    k: seed,
  });
  if (!data) return [];
  return asStringArray(data.suggestions, 20);
}

/**
 * Amazon Product (engine=amazon_product) — one ASIN's full record. Also the
 * fallback for the direct product-page scrape when Amazon bot-checks it.
 */
export async function fetchAmazonProductViaSerpApi(
  asin: string,
  marketplace: Marketplace = "US"
): Promise<SerpApiAmazonProduct | null> {
  const data = await callSerpApi({
    engine: "amazon_product",
    amazon_domain: domainFor(marketplace),
    asin,
  });
  if (!data) return null;

  // SerpApi has shipped both spellings of this key across versions of the
  // Amazon endpoints; accept either rather than silently returning nothing.
  const product = rec(data.product_results) ?? rec(data.product_result) ?? rec(data.product);
  if (!product) {
    console.error(
      `[serpApi] no product results for ${asin}: ${str(rec(data.search_metadata)?.status) ?? "unknown"}`
    );
    return null;
  }

  const productInfo = extractFromProductInformation(product.product_information ?? data.product_information);
  const categoryPath = asStringArray(product.categories ?? data.categories, 12);
  const bulletPoints = [
    ...asStringArray(product.feature_bullets, 8),
    ...asStringArray(data.about_item, 8),
  ];
  const firstImage = list(product.images)[0];
  const coverImageUrl = str(firstImage) ?? str(rec(firstImage)?.link) ?? str(product.thumbnail);

  const relatedAsins = new Set<string>();
  collectAsins(data.bought_together, relatedAsins);
  collectAsins(data.related_products, relatedAsins);
  collectAsins(data.also_bought, relatedAsins);
  collectAsins(product.bought_together, relatedAsins);
  collectAsins(product.related_products, relatedAsins);

  const reviewsBlock = rec(data.reviews_information) ?? rec(product.reviews_information) ?? {};

  const price = rec(product.price);

  return {
    title: str(product.title),
    author: extractAuthor(product),
    price: parsePriceText(price?.value ?? price?.raw ?? product.price),
    rating: num(product.rating),
    reviewCount: num(product.ratings_total) ?? num(product.reviews),
    description: str(product.description),
    bulletPoints: bulletPoints.length > 0 ? bulletPoints.slice(0, 8) : undefined,
    categoryPath: categoryPath.length > 0 ? categoryPath : undefined,
    coverImageUrl,
    relatedAsins: Array.from(relatedAsins),
    relatedTitles: [
      ...asStringArray(data.bought_together, 8),
      ...asStringArray(data.related_products, 12),
    ],
    reviewSnippets: [
      ...asStringArray(reviewsBlock.top_reviews, 10),
      ...asStringArray(data.reviews, 10),
    ],
    formats: asStringArray(product.variants ?? product.formats, 8),
    ...productInfo,
  };
}

export interface SnowballCrawlResult {
  /** Keyword corpus: related searches, competitor titles, blurb phrases, review vocabulary. */
  phrases: string[];
  /** Product-targeting list, deduped, ASINs only. */
  asins: string[];
  /** Competitor identities for comp-author/title keywords. */
  competitors: Array<{ asin: string; title?: string; author?: string; rating?: number; reviewCount?: number }>;
  /** Credits actually spent, so the caller can report cost. */
  creditsUsed: number;
}

/**
 * The snowball crawl from the SerpApi guide: search each seed, take the top
 * organic ASINs, read each product, queue *its* related/bought-together
 * ASINs, stop at the hop limit. Deduped by ASIN and hard-capped by a credit
 * budget — each call is a credit and the queue grows fast.
 */
export async function crawlAmazonViaSerpApi(
  seeds: string[],
  marketplace: Marketplace = "US",
  options: { maxHops?: number; asinsPerHop?: number; creditBudget?: number } = {}
): Promise<SnowballCrawlResult> {
  const { maxHops = 2, asinsPerHop = 5, creditBudget = 12 } = options;
  const empty: SnowballCrawlResult = { phrases: [], asins: [], competitors: [], creditsUsed: 0 };
  if (!isSerpApiConfigured() || seeds.length === 0) return empty;

  const phrases = new Set<string>();
  const seenAsins = new Set<string>();
  const competitors: SnowballCrawlResult["competitors"] = [];
  let creditsUsed = 0;

  const queue: string[] = [];

  for (const seed of seeds) {
    if (creditsUsed >= creditBudget) break;
    const search = await searchAmazonViaSerpApi(seed, marketplace);
    creditsUsed += 1;
    if (!search) continue;

    for (const phrase of [...search.relatedSearches, ...search.organicTitles, ...search.organicAuthors]) {
      phrases.add(phrase);
    }
    for (const asin of search.asins.slice(0, asinsPerHop)) {
      if (!seenAsins.has(asin)) queue.push(asin);
    }
  }

  for (let hop = 0; hop < maxHops && queue.length > 0 && creditsUsed < creditBudget; hop += 1) {
    const batch = queue.splice(0, asinsPerHop);
    for (const asin of batch) {
      if (creditsUsed >= creditBudget) break;
      if (seenAsins.has(asin)) continue;
      seenAsins.add(asin);

      const product = await fetchAmazonProductViaSerpApi(asin, marketplace);
      creditsUsed += 1;
      if (!product) continue;

      competitors.push({
        asin,
        title: product.title,
        author: product.author,
        rating: product.rating,
        reviewCount: product.reviewCount,
      });

      const title = cleanBookTitle(product.title);
      if (title) phrases.add(title);
      if (product.author) phrases.add(product.author);
      // Short bullets read as phrases; long ones are marketing sentences.
      for (const bullet of product.bulletPoints ?? []) {
        if (bullet.split(/\s+/).length <= 6) phrases.add(bullet);
      }
      for (const relatedTitle of product.relatedTitles ?? []) {
        const cleaned = cleanBookTitle(relatedTitle);
        if (cleaned) phrases.add(cleaned);
      }
      for (const relatedAsin of product.relatedAsins ?? []) {
        if (!seenAsins.has(relatedAsin)) queue.push(relatedAsin);
      }
    }
  }

  return {
    phrases: Array.from(phrases),
    asins: Array.from(seenAsins),
    competitors,
    creditsUsed,
  };
}
