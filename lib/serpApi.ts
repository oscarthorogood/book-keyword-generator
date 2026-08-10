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

export interface SerpApiAmazonSearch {
  /** Amazon's own keyword expansions for the query — the highest-value section for Broad/Phrase. */
  relatedSearches: string[];
  /** Competitor book titles ranking for the term, subtitle stripped. */
  organicTitles: string[];
  /** Author names from those results — exact-match keyword candidates. */
  organicAuthors: string[];
  /** ASINs for the product-targeting list and the snowball crawl. */
  asins: string[];
  /** Titles/brands paying for the term — a proxy for its commercial value. */
  sponsoredTitles: string[];
}

export function isSerpApiConfigured(): boolean {
  return !!SERPAPI_API_KEY;
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
async function callSerpApi(params: Record<string, string>): Promise<Record<string, any> | null> {
  if (!SERPAPI_API_KEY) return null;

  const query = new URLSearchParams({ ...params, api_key: SERPAPI_API_KEY });
  const label = `${params.engine} ${params.k ?? params.q ?? params.asin ?? ""}`.trim();

  try {
    const res = await fetchWithTimeout(`${SERPAPI_ENDPOINT}?${query.toString()}`);
    if (!res.ok) {
      console.error(`[serpApi] ${label} failed: HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    const status = data?.search_metadata?.status;
    if (data?.error || (status && status !== "Success")) {
      console.error(`[serpApi] ${label} returned ${status ?? "an error"}: ${data?.error ?? "unknown"}`);
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
function parsePrice(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const match = raw.match(/[\d,]+\.?\d*/);
    if (match) return parseFloat(match[0].replace(/,/g, ""));
  }
  return undefined;
}

/** Amazon book titles carry a subtitle and series furniture; the part before the colon is the searchable title. */
export function cleanBookTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const withoutSeries = raw.replace(/\([^)]*\)/g, " ");
  const beforeSubtitle = withoutSeries.split(":")[0];
  const cleaned = beforeSubtitle.replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : undefined;
}

/** Amazon book bylines are usually "by Author Name Format" — this API's fields don't reliably separate them, so try a few shapes. */
function extractAuthor(product: Record<string, any>): string | undefined {
  if (typeof product.author === "string") return product.author;
  if (Array.isArray(product.authors) && product.authors.length > 0) {
    return product.authors
      .map((a: any) => (typeof a === "string" ? a : a?.name))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof product.brand === "string") return product.brand;
  return undefined;
}

/** product_information is a free-form key/value dict whose exact keys vary by product type/marketplace. */
function extractFromProductInformation(info: Record<string, string> | undefined) {
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
  if (!Array.isArray(value)) return;
  for (const entry of value) {
    const asin = entry && typeof entry === "object" ? (entry as Record<string, unknown>).asin : undefined;
    if (typeof asin === "string" && /^[A-Z0-9]{10}$/i.test(asin)) into.add(asin.toUpperCase());
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
  for (const result of Array.isArray(data.organic_results) ? data.organic_results.slice(0, 15) : []) {
    const title = cleanBookTitle(typeof result?.title === "string" ? result.title : undefined);
    if (title) organicTitles.push(title);
    const author = extractAuthor(result ?? {});
    if (author) organicAuthors.push(author.replace(/\s+/g, " ").trim());
  }

  return {
    relatedSearches: asStringArray(data.related_searches, 25),
    organicTitles,
    organicAuthors,
    asins: Array.from(asins),
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
    q: seed,
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
  const product = data.product_results ?? data.product_result ?? data.product ?? null;
  if (!product) {
    console.error(`[serpApi] no product results for ${asin}: ${data.search_metadata?.status ?? "unknown"}`);
    return null;
  }

  const productInfo = extractFromProductInformation(product.product_information ?? data.product_information);
  const categoryPath = asStringArray(product.categories ?? data.categories, 12);
  const bulletPoints = [
    ...asStringArray(product.feature_bullets, 8),
    ...asStringArray(data.about_item, 8),
  ];
  const coverImageUrl: string | undefined = Array.isArray(product.images)
    ? typeof product.images[0] === "string"
      ? product.images[0]
      : product.images[0]?.link
    : product.thumbnail;

  const relatedAsins = new Set<string>();
  collectAsins(data.bought_together, relatedAsins);
  collectAsins(data.related_products, relatedAsins);
  collectAsins(data.also_bought, relatedAsins);
  collectAsins(product.bought_together, relatedAsins);
  collectAsins(product.related_products, relatedAsins);

  const reviewsBlock = data.reviews_information ?? product.reviews_information ?? {};

  return {
    title: typeof product.title === "string" ? product.title : undefined,
    author: extractAuthor(product),
    price: parsePrice(product.price?.value ?? product.price?.raw ?? product.price),
    rating: typeof product.rating === "number" ? product.rating : undefined,
    reviewCount:
      typeof product.ratings_total === "number"
        ? product.ratings_total
        : typeof product.reviews === "number"
          ? product.reviews
          : undefined,
    description: typeof product.description === "string" ? product.description : undefined,
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
