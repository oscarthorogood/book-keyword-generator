const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_TIMEOUT_MS = 15000;

export interface AmazonPageMetadata {
  title?: string;
  author?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  categories?: string[];
  features?: string[];
  keywords?: string[];
  description?: string;
  language?: string;
  pageType?: string;
}

export function isFirecrawlConfigured(): boolean {
  return !!FIRECRAWL_API_KEY;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Firecrawl's structured extraction API for Amazon product pages — extracts
 * metadata fields (title, author, price, rating, categories, features) using
 * LLM-based extraction. This is more resilient to page structure changes than
 * CSS selector-based extraction and captures semantic information like features
 * and categories that can be used to generate better keyword seeds.
 *
 * Falls back to empty object on any error or missing key. Used to enhance
 * keyword seed generation with richer product context.
 */
export async function extractAmazonMetadata(url: string): Promise<AmazonPageMetadata> {
  if (!FIRECRAWL_API_KEY) return {};

  try {
    const schema = {
      type: "object",
      properties: {
        title: { type: "string", description: "Book title" },
        author: { type: "string", description: "Primary author name" },
        price: { type: "number", description: "Retail price in USD" },
        rating: { type: "number", description: "Star rating (e.g., 4.5)" },
        reviewCount: { type: "number", description: "Total number of reviews" },
        categories: {
          type: "array",
          items: { type: "string" },
          description: "Book categories and subcategories",
        },
        features: {
          type: "array",
          items: { type: "string" },
          description: "Key product features or marketing bullets",
        },
        keywords: {
          type: "array",
          items: { type: "string" },
          description: "Keywords mentioned in title, features, or description",
        },
        description: { type: "string", description: "Book description/blurb" },
        language: { type: "string", description: "Language of the book" },
        pageType: { type: "string", description: "Type of page (e.g., 'kindle', 'paperback', 'hardcover')" },
      },
    };

    const res = await fetchWithTimeout(
      "https://api.firecrawl.dev/v1/scrape",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({
          url,
          formats: ["extract"],
          extractorOptions: { schema },
          onlyMainContent: true,
        }),
      },
      FIRECRAWL_TIMEOUT_MS
    );

    if (!res.ok) {
      console.error(`[extractAmazonMetadata] Firecrawl HTTP ${res.status} for ${url}`);
      return {};
    }

    const json = (await res.json()) as {
      success?: boolean;
      data?: { extract?: AmazonPageMetadata };
    };
    return json.data?.extract ?? {};
  } catch (err) {
    console.error("[extractAmazonMetadata] Firecrawl request failed:", err instanceof Error ? err.message : err);
    return {};
  }
}

/**
 * Firecrawl (firecrawl.dev) renders JS and returns a page as clean markdown
 * — used here purely to give the AI ranking step (lib/aiRanker.ts) richer
 * natural-language context than the field-by-field cheerio extraction in
 * lib/scrape.ts captures (fuller review text, Q&A, editorial copy, etc).
 * It is NOT used as a fetch mechanism for the structured scrapes elsewhere
 * in this app — those still go through ScraperAPI (or direct) and cheerio
 * selectors, since Firecrawl's markdown output would break that
 * selector-based extraction. Request/response shape is written against
 * Firecrawl's documented v1 /scrape contract but unverified against a live
 * call from this environment — fails soft to undefined on any error or
 * missing key, same as every other optional source in this app.
 */
export async function scrapeMarkdown(url: string): Promise<string | undefined> {
  if (!FIRECRAWL_API_KEY) return undefined;

  try {
    const res = await fetchWithTimeout(
      "https://api.firecrawl.dev/v1/scrape",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
        },
        body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      },
      FIRECRAWL_TIMEOUT_MS
    );

    if (!res.ok) {
      console.error(`[scrapeMarkdown] Firecrawl HTTP ${res.status} for ${url}`);
      return undefined;
    }

    const json = (await res.json()) as { success?: boolean; data?: { markdown?: string } };
    return json.data?.markdown;
  } catch (err) {
    console.error("[scrapeMarkdown] Firecrawl request failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
