/**
 * SerpApi's Amazon Product API (https://serpapi.com/amazon-product-api) as
 * an alternative to scraping the Amazon product page directly. Amazon
 * CAPTCHAs/blocks product-page requests from cloud/datacenter IPs (see
 * lib/scrape.ts), which is the "ASIN autofill keeps failing" symptom —
 * SerpApi runs the fetch from its own infrastructure and returns structured
 * JSON, sidestepping that entirely. Optional: unset SERPAPI_API_KEY falls
 * straight back to the direct scrape in lib/amazonLookup.ts.
 *
 * Field mapping below is based on SerpApi's documented Amazon Product API
 * response shape; it hasn't been exercised against a live key in this repo,
 * so double-check field names against a real response if data comes back
 * sparse and adjust the paths here rather than assuming the scrape is at
 * fault.
 */

const SERPAPI_API_KEY = process.env.SERPAPI_API_KEY;
const SERPAPI_ENDPOINT = "https://serpapi.com/search.json";
const FETCH_TIMEOUT_MS = 15000;

const MARKETPLACE_DOMAINS = {
  US: "amazon.com",
  UK: "amazon.co.uk",
  CA: "amazon.ca",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
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

/** Pulls a numeric field out of "$12.99"-style strings. */
function parsePrice(raw: unknown): number | undefined {
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") {
    const match = raw.match(/[\d,]+\.?\d*/);
    if (match) return parseFloat(match[0].replace(/,/g, ""));
  }
  return undefined;
}

/** Amazon book bylines are usually "by Author Name Format" — this API's title/author fields don't reliably separate them, so try a few shapes. */
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

/**
 * Fetches structured product data for an ASIN via SerpApi. Returns null on
 * any failure (not configured, non-2xx, missing product data) so the caller
 * can fall back to direct scraping without special-casing errors.
 */
export async function fetchAmazonProductViaSerpApi(
  asin: string,
  marketplace: keyof typeof MARKETPLACE_DOMAINS = "US"
): Promise<SerpApiAmazonProduct | null> {
  if (!SERPAPI_API_KEY) return null;

  const domain = MARKETPLACE_DOMAINS[marketplace] ?? MARKETPLACE_DOMAINS.US;
  const params = new URLSearchParams({
    engine: "amazon",
    amazon_domain: domain,
    asin,
    api_key: SERPAPI_API_KEY,
  });

  try {
    const res = await fetchWithTimeout(`${SERPAPI_ENDPOINT}?${params.toString()}`);
    if (!res.ok) {
      console.error(`SerpApi Amazon lookup failed for ${asin}: HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const product = data.product_result ?? data.product ?? null;
    if (!product) {
      console.error(
        `SerpApi returned no product_result for ${asin}:`,
        data.search_metadata?.status ?? data.error ?? "unknown"
      );
      return null;
    }

    const productInfo = extractFromProductInformation(product.product_information);
    const categoryPath: string[] = Array.isArray(product.categories)
      ? product.categories.map((c: any) => (typeof c === "string" ? c : c?.name)).filter(Boolean)
      : [];
    const bulletPoints: string[] = Array.isArray(product.feature_bullets)
      ? product.feature_bullets.filter((b: unknown): b is string => typeof b === "string")
      : [];
    const coverImageUrl: string | undefined = Array.isArray(product.images)
      ? typeof product.images[0] === "string"
        ? product.images[0]
        : product.images[0]?.link
      : product.thumbnail;

    return {
      title: typeof product.title === "string" ? product.title : undefined,
      author: extractAuthor(product),
      price: parsePrice(product.price?.value ?? product.price?.raw ?? product.price),
      rating: typeof product.rating === "number" ? product.rating : undefined,
      reviewCount: typeof product.ratings_total === "number" ? product.ratings_total : undefined,
      description: typeof product.description === "string" ? product.description : undefined,
      bulletPoints: bulletPoints.length > 0 ? bulletPoints.slice(0, 5) : undefined,
      categoryPath: categoryPath.length > 0 ? categoryPath : undefined,
      coverImageUrl,
      ...productInfo,
    };
  } catch (err) {
    console.error(`SerpApi Amazon lookup errored for ${asin}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
