const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_TIMEOUT_MS = 25000;

/**
 * What Firecrawl's LLM extraction pulls off an Amazon book page.
 *
 * Firecrawl fetches from its own infrastructure and renders the page, so it
 * gets a real product page where a direct request from a datacenter IP gets a
 * CAPTCHA — which makes it the most reliable capture path this app has when
 * it's configured. The schema deliberately covers everything the keyword
 * pipeline needs (identity, genre placement, ranking, comparable titles,
 * review language), not just the few fields it used to seed autocomplete with.
 */
export interface AmazonPageMetadata {
  title?: string;
  author?: string;
  series?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  /** Breadcrumb / category placement, most general first. */
  categories?: string[];
  bestSellerRanks?: Array<{ rank?: number; category?: string }>;
  features?: string[];
  keywords?: string[];
  description?: string;
  /**
   * "Customers also bought" / "Frequently bought together" / "Compare with
   * similar" books. Title and author are extracted as one object per book
   * rather than two parallel arrays — nothing guarantees an LLM returns two
   * lists in the same order or at the same length, and pairing them by index
   * would attach the wrong author to a book the app then bids on by name.
   */
  comparableBooks?: Array<{ title?: string; author?: string }>;
  reviewSnippets?: string[];
  customerQuestions?: string[];
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  isbn10?: string;
  isbn13?: string;
  language?: string;
  pageType?: string;
  coverImageUrl?: string;
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

const EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Book title, without the subtitle or format suffix" },
    author: { type: "string", description: "Primary author name" },
    series: { type: "string", description: "Series name, if the book belongs to one" },
    price: { type: "number", description: "Current retail price as a number" },
    rating: { type: "number", description: "Star rating, e.g. 4.5" },
    reviewCount: { type: "number", description: "Total number of ratings/reviews" },
    categories: {
      type: "array",
      items: { type: "string" },
      description:
        "Category breadcrumb and best-seller category names, e.g. 'Mystery, Thriller & Suspense', 'Cozy Mystery'. Most general first.",
    },
    bestSellerRanks: {
      type: "array",
      description: "Best Sellers Rank entries",
      items: {
        type: "object",
        properties: {
          rank: { type: "number", description: "Rank number" },
          category: { type: "string", description: "Category the rank is in" },
        },
      },
    },
    features: { type: "array", items: { type: "string" }, description: "Marketing bullets / editorial highlights" },
    keywords: {
      type: "array",
      items: { type: "string" },
      description: "Genre, trope and theme phrases that describe this book, drawn from the page text",
    },
    description: { type: "string", description: "Full book description / blurb" },
    comparableBooks: {
      type: "array",
      description:
        "Other books shown on the page: customers also bought, frequently bought together, compare with similar items. One entry per book.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "That book's title" },
          author: { type: "string", description: "That book's author, if shown" },
        },
      },
    },
    reviewSnippets: {
      type: "array",
      items: { type: "string" },
      description: "Customer review excerpts shown on the page, in the reviewers' own words",
    },
    customerQuestions: {
      type: "array",
      items: { type: "string" },
      description: "Questions from the customer questions & answers section",
    },
    publisher: { type: "string" },
    publicationDate: { type: "string" },
    pageCount: { type: "number" },
    isbn10: { type: "string" },
    isbn13: { type: "string" },
    language: { type: "string" },
    pageType: { type: "string", description: "Format of this listing: kindle, paperback, hardcover or audiobook" },
    coverImageUrl: { type: "string", description: "URL of the main cover image" },
  },
};

interface FirecrawlScrapeResponse {
  success?: boolean;
  data?: {
    extract?: AmazonPageMetadata;
    json?: AmazonPageMetadata;
    llm_extraction?: AmazonPageMetadata;
    markdown?: string;
  };
  error?: string;
}

async function postScrape(
  body: Record<string, unknown>,
  timeoutMs: number
): Promise<FirecrawlScrapeResponse | null> {
  const res = await fetchWithTimeout(
    "https://api.firecrawl.dev/v1/scrape",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify(body),
    },
    timeoutMs
  );

  if (!res.ok) {
    console.error(`[firecrawl] HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return null;
  }
  return (await res.json()) as FirecrawlScrapeResponse;
}

/**
 * Structured extraction of an Amazon book page.
 *
 * Firecrawl has shipped more than one request shape for structured
 * extraction: LLM extraction now lives under the `json` format with the
 * schema in `jsonOptions`, and the older `extract` format with a top-level
 * `extract` block is still accepted. Which one an account gets depends on the
 * API version it's on, so this tries the current shape first and falls back
 * to the legacy one — and reads the payload from whichever key comes back.
 *
 * Both shapes name the format as a *string*, which the nested-object form
 * this used to send did not: `formats: [{ type: "json", … }]` belongs to the
 * v2 endpoint and v1 rejected it outright with a 400, so the fallback attempt
 * could never succeed and Amazon's bot checks had nothing to fall back to.
 *
 * `timeoutMs` bounds both attempts together, not each one: this runs inside a
 * capture that has its own deadline (lib/bookSnapshot.ts), and a retry that
 * starts after the budget is gone can only make the caller late.
 */
export async function extractAmazonMetadata(
  url: string,
  timeoutMs: number = FIRECRAWL_TIMEOUT_MS
): Promise<AmazonPageMetadata> {
  if (!FIRECRAWL_API_KEY) return {};

  const attempts: Record<string, unknown>[] = [
    { url, formats: ["json"], jsonOptions: { schema: EXTRACTION_SCHEMA }, onlyMainContent: false },
    { url, formats: ["extract"], extract: { schema: EXTRACTION_SCHEMA }, onlyMainContent: false },
  ];

  const endsAt = Date.now() + timeoutMs;
  for (const body of attempts) {
    const remaining = endsAt - Date.now();
    if (remaining <= 0) break;
    try {
      const json = await postScrape(body, remaining);
      const extracted = json?.data?.extract ?? json?.data?.json ?? json?.data?.llm_extraction;
      if (extracted && Object.keys(extracted).length > 0) return extracted;
    } catch (err) {
      console.error("[extractAmazonMetadata] request failed:", err instanceof Error ? err.message : err);
    }
  }

  return {};
}

/**
 * The page as clean markdown. Kept as extra natural-language context for the
 * AI relevance pass (lib/aiRanker.ts) — fuller review text and editorial copy
 * than the field-by-field extraction above captures.
 */
export async function scrapeMarkdown(
  url: string,
  timeoutMs: number = FIRECRAWL_TIMEOUT_MS
): Promise<string | undefined> {
  if (!FIRECRAWL_API_KEY) return undefined;

  try {
    const json = await postScrape({ url, formats: ["markdown"], onlyMainContent: true }, timeoutMs);
    return json?.data?.markdown;
  } catch (err) {
    console.error("[scrapeMarkdown] Firecrawl request failed:", err instanceof Error ? err.message : err);
    return undefined;
  }
}
