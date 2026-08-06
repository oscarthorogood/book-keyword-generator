const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
const FIRECRAWL_TIMEOUT_MS = 15000;

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
