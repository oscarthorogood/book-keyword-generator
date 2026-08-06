import * as cheerio from "cheerio";
import { KeywordCandidate, Marketplace, ProductPageData } from "./types";

const AMAZON_DOMAINS: Record<Marketplace, string> = {
  US: "amazon.com",
  CA: "amazon.ca",
  UK: "amazon.co.uk",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
};

// Market IDs used by Amazon's unofficial autocomplete endpoint.
const AUTOCOMPLETE_MARKET_ID: Record<Marketplace, string> = {
  US: "1",
  CA: "7",
  UK: "3",
  DE: "4",
  FR: "5",
  IT: "35691",
  ES: "44551",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const PAGE_TIMEOUT_MS = 8000;
const AUTOCOMPLETE_TIMEOUT_MS = 4000;

async function fetchWithTimeout(
  url: string,
  init: RequestInit | undefined,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Used to keep
 * the autocomplete sweep from firing dozens of simultaneous requests at
 * Amazon's unofficial endpoint (which risks getting the whole batch blocked)
 * while still finishing well inside a serverless function's time budget.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const AUTOCOMPLETE_MODIFIERS = ["book", "series", "novel", "audiobook", "kindle"];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
const MAX_AUTOCOMPLETE_SEEDS = 40;
const MAX_GOOGLE_SUGGEST_SEEDS = 20;
const AUTOCOMPLETE_CONCURRENCY = 15;

/**
 * Amazon's autocomplete returns different completions depending on the next
 * character typed, so sweeping a-z after the title ("<title> a", "<title>
 * b", ...) harvests far more real suggestions than the bare title alone —
 * a well-known free technique for multiplying yield from the same endpoint.
 */
export function buildAutocompleteSeeds(title: string, author?: string): string[] {
  const cleanTitle = title.trim();
  if (!cleanTitle) return [];

  const seeds = new Set<string>();
  seeds.add(cleanTitle);
  for (const modifier of AUTOCOMPLETE_MODIFIERS) seeds.add(`${cleanTitle} ${modifier}`);
  if (author) seeds.add(`${cleanTitle} ${author}`);
  for (const letter of ALPHABET) seeds.add(`${cleanTitle} ${letter}`);

  return Array.from(seeds).slice(0, MAX_AUTOCOMPLETE_SEEDS);
}

/**
 * Amazon has no official autocomplete/suggestions API. This hits the same
 * unofficial endpoint the amazon.com search box uses. It is fragile by
 * nature — Amazon can change or block it without notice — so callers must
 * treat a failure here as "no autocomplete keywords" rather than a hard error.
 */
export async function getAutocompleteSuggestions(
  seedTerm: string,
  marketplace: Marketplace
): Promise<KeywordCandidate[]> {
  const marketId = AUTOCOMPLETE_MARKET_ID[marketplace];
  const domain = AMAZON_DOMAINS[marketplace];
  const url = `https://completion.${domain}/api/2017/suggestions?limit=10&prefix=${encodeURIComponent(
    seedTerm
  )}&suggestion-type=KEYWORD&page-type=Gateway&alias=stripbooks&site-variant=desktop&version=3&event=onKeyPress&wc=&lop=en_US&mid=${marketId}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
      AUTOCOMPLETE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const json = (await res.json()) as {
      suggestions?: { value?: string }[];
    };

    return (json.suggestions ?? [])
      .map((s) => s.value?.trim().toLowerCase())
      .filter((v): v is string => !!v)
      .map((text) => ({ text, sources: ["autocomplete" as const] }));
  } catch {
    return [];
  }
}

/**
 * Fetches autocomplete completions across every seed in `seedTerms` (see
 * buildAutocompleteSeeds), bounded to AUTOCOMPLETE_CONCURRENCY in flight.
 */
export async function getAutocompleteKeywordSet(
  seedTerms: string[],
  marketplace: Marketplace
): Promise<KeywordCandidate[]> {
  const results = await mapWithConcurrency(seedTerms, AUTOCOMPLETE_CONCURRENCY, (term) =>
    getAutocompleteSuggestions(term, marketplace)
  );
  return results.flat();
}

/**
 * Google's own unofficial search-suggest endpoint (the same one that powers
 * the omnibox/search-box dropdown; widely used, well-established, no key).
 * Surfaces what readers actually search for on the wider web, which can
 * differ from what Amazon's own on-site autocomplete returns — a different
 * signal from the same alphabet-soup seeding technique used for Amazon above.
 */
export async function getGoogleAutocompleteSuggestions(seedTerm: string): Promise<KeywordCandidate[]> {
  const url = `https://www.google.com/complete/search?client=firefox&hl=en&q=${encodeURIComponent(
    seedTerm
  )}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
      AUTOCOMPLETE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const json = (await res.json()) as [string, string[]];
    const suggestions = json?.[1] ?? [];

    return suggestions
      .map((s) => s?.trim().toLowerCase())
      .filter((v): v is string => !!v)
      .map((text) => ({ text, sources: ["google-autocomplete" as const] }));
  } catch {
    return [];
  }
}

/**
 * Same seed list as the Amazon sweep, capped shorter (Google's endpoint gets
 * queried once per seed just like Amazon's, so this bounds the *combined*
 * request count for a single generate call).
 */
export async function getGoogleAutocompleteKeywordSet(seedTerms: string[]): Promise<KeywordCandidate[]> {
  const results = await mapWithConcurrency(
    seedTerms.slice(0, MAX_GOOGLE_SUGGEST_SEEDS),
    AUTOCOMPLETE_CONCURRENCY,
    (term) => getGoogleAutocompleteSuggestions(term)
  );
  return results.flat();
}

/**
 * YouTube's search box uses the same unofficial Google suggest endpoint as
 * getGoogleAutocompleteSuggestions, just scoped to YouTube via `ds=yt`. This
 * surfaces how people search for book content on video (BookTok/BookTube
 * reviews, "explained", "audiobook" style queries) — a different register
 * than either the Amazon or plain Google suggest corpora.
 */
export async function getYoutubeAutocompleteSuggestions(seedTerm: string): Promise<KeywordCandidate[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=en&q=${encodeURIComponent(
    seedTerm
  )}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
      AUTOCOMPLETE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const json = (await res.json()) as [string, string[]];
    const suggestions = json?.[1] ?? [];

    return suggestions
      .map((s) => s?.trim().toLowerCase())
      .filter((v): v is string => !!v)
      .map((text) => ({ text, sources: ["youtube-autocomplete" as const] }));
  } catch {
    return [];
  }
}

export async function getYoutubeAutocompleteKeywordSet(seedTerms: string[]): Promise<KeywordCandidate[]> {
  const results = await mapWithConcurrency(
    seedTerms.slice(0, MAX_GOOGLE_SUGGEST_SEEDS),
    AUTOCOMPLETE_CONCURRENCY,
    (term) => getYoutubeAutocompleteSuggestions(term)
  );
  return results.flat();
}

/**
 * DuckDuckGo's own unofficial autocomplete endpoint — a third independent
 * suggest corpus alongside Amazon's and Google's, free and keyless like the
 * others. Returns `{ phrase: string }[]` rather than Google's `[query,
 * [strings]]` shape.
 */
export async function getDuckDuckGoAutocompleteSuggestions(seedTerm: string): Promise<KeywordCandidate[]> {
  const url = `https://ac.duckduckgo.com/ac/?q=${encodeURIComponent(seedTerm)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } },
      AUTOCOMPLETE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const json = (await res.json()) as { phrase?: string }[];

    return json
      .map((s) => s.phrase?.trim().toLowerCase())
      .filter((v): v is string => !!v)
      .map((text) => ({ text, sources: ["duckduckgo-autocomplete" as const] }));
  } catch {
    return [];
  }
}

export async function getDuckDuckGoAutocompleteKeywordSet(seedTerms: string[]): Promise<KeywordCandidate[]> {
  const results = await mapWithConcurrency(
    seedTerms.slice(0, MAX_GOOGLE_SUGGEST_SEEDS),
    AUTOCOMPLETE_CONCURRENCY,
    (term) => getDuckDuckGoAutocompleteSuggestions(term)
  );
  return results.flat();
}

function extractIsbns($: cheerio.CheerioAPI): { isbn10?: string; isbn13?: string } {
  let isbn10: string | undefined;
  let isbn13: string | undefined;

  $("#detailBullets_feature_div li, #productDetails_detailBullets_sections1 tr").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const isbn10Match = text.match(/ISBN-10\s*[:\-]?\s*([0-9Xx]{10})/);
    const isbn13Match = text.match(/ISBN-13\s*[:\-]?\s*([0-9\-]{13,17})/);
    if (isbn10Match) isbn10 = isbn10Match[1];
    if (isbn13Match) isbn13 = isbn13Match[1].replace(/-/g, "");
  });

  return { isbn10, isbn13 };
}

const EMPTY_PRODUCT_PAGE: ProductPageData = { compTitles: [], categories: [], compAsins: [] };

function resolveAmazonUrl(href: string, domain: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.${domain}${href.startsWith("/") ? "" : "/"}${href}`;
}

/**
 * Scrapes the book's own Amazon product page for title/author/ISBN plus
 * thematic context: "customers also bought" titles + their ASINs, and
 * category/best-seller placement text. Best-effort — returns whatever it can
 * find, empty arrays on total failure.
 */
export async function scrapeProductPage(
  asin: string,
  marketplace: Marketplace
): Promise<ProductPageData> {
  const domain = AMAZON_DOMAINS[marketplace];
  const url = `https://www.${domain}/dp/${encodeURIComponent(asin)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      PAGE_TIMEOUT_MS
    );
    if (!res.ok) return EMPTY_PRODUCT_PAGE;

    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $("#productTitle").first().text().trim() || undefined;
    const authorLink = $("#bylineInfo .author a, .author a.contributorNameID").first();
    const author = authorLink.text().trim() || undefined;
    const authorHref = authorLink.attr("href");
    const authorUrl = authorHref ? resolveAmazonUrl(authorHref, domain) : undefined;

    const { isbn10, isbn13 } = extractIsbns($);

    const descriptionText =
      [
        $("#bookDescription_feature_div").text(),
        $("#productDescription").text(),
        $("#editorialReviews_feature_div").text(),
      ]
        .map((t) => t.replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .join(" ") || undefined;

    const compTitles = new Set<string>();
    const compAsins = new Set<string>();
    $(
      '[data-a-carousel-options*="also-bought"] a[href*="/dp/"], [id*="similarities"] a[href*="/dp/"], .a-carousel-card a[href*="/dp/"]'
    ).each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (asinMatch && asinMatch[1].toUpperCase() !== asin.toUpperCase()) {
        compAsins.add(asinMatch[1].toUpperCase());
      }
      const alt = $(el).find("img").attr("alt")?.trim();
      const text = alt || $(el).text().trim();
      if (text && text.length > 3) compTitles.add(text);
    });

    const categories = new Set<string>();
    $("#wayfinding-breadcrumbs_feature_div a, #detailBulletsWrapper_feature_div a").each(
      (_, el) => {
        const text = $(el).text().trim();
        if (text) categories.add(text);
      }
    );
    $("#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr").each(
      (_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (/Best Sellers Rank/i.test(text)) {
          const matches = text.matchAll(/#[\d,]+\s+in\s+([A-Za-z0-9 &'\-]+)/g);
          for (const m of matches) categories.add(m[1].trim());
        }
      }
    );

    return {
      title,
      author,
      authorUrl,
      isbn10,
      isbn13,
      compTitles: Array.from(compTitles).slice(0, 15),
      categories: Array.from(categories).slice(0, 15),
      compAsins: Array.from(compAsins).slice(0, 5),
      descriptionText,
    };
  } catch {
    return EMPTY_PRODUCT_PAGE;
  }
}

const RELATED_CATEGORY_ASIN_LIMIT = 3;

/**
 * One hop out: scrapes a handful of the "customers also bought" titles'
 * own product pages for their categories, borrowing thematic keywords from
 * books already proven to sell to the same readers. Each lookup degrades
 * independently — a blocked or missing page just contributes nothing.
 */
export async function scrapeRelatedCategories(
  compAsins: string[],
  marketplace: Marketplace
): Promise<string[]> {
  const targets = compAsins.slice(0, RELATED_CATEGORY_ASIN_LIMIT);
  if (targets.length === 0) return [];

  const results = await mapWithConcurrency(targets, targets.length, (asin) =>
    scrapeProductPage(asin, marketplace)
  );

  const categories = new Set<string>();
  for (const result of results) {
    for (const category of result.categories) categories.add(category);
  }
  return Array.from(categories);
}

/**
 * Scrapes the book's own "Customer questions & answers" page. Real reader
 * questions are natural-language buyer phrases ("is this good for a 10 year
 * old", "does this come with a case") that differ from both the review and
 * autocomplete registers. This is a separate server-rendered page (not an
 * AJAX-only widget), so it's scrapeable the same way as the product page
 * itself, but the exact markup isn't verified against a live page from this
 * environment — treat a miss as "no Q&A found," never a hard failure.
 */
export async function scrapeCustomerQnA(asin: string, marketplace: Marketplace): Promise<string[]> {
  const domain = AMAZON_DOMAINS[marketplace];
  const url = `https://www.${domain}/ask/questions/asin/${encodeURIComponent(asin)}/1`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      PAGE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);

    const questions = new Set<string>();
    $("[class*='question'] span, [class*='Question'] span, .askQuestionText").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 5 && text.length < 300) questions.add(text);
    });

    return Array.from(questions).slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Scrapes the book's customer reviews page for review body text — "voice of
 * the customer" phrasing that captures how actual readers describe the book,
 * distinct from marketing copy or category taxonomy. Amazon sometimes serves
 * review pages behind extra bot-detection compared to the product page
 * itself; a block here just yields no candidates from this source, same
 * degrade-to-empty pattern as the rest of this file.
 */
export async function scrapeCustomerReviews(asin: string, marketplace: Marketplace): Promise<string[]> {
  const domain = AMAZON_DOMAINS[marketplace];
  const url = `https://www.${domain}/product-reviews/${encodeURIComponent(asin)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      PAGE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);

    const bodies: string[] = [];
    $('[data-hook="review-body"]').each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) bodies.push(text);
    });

    return bodies.slice(0, 20);
  } catch {
    return [];
  }
}

/**
 * Scrapes the author's Amazon page for their other book titles — a form of
 * comp-title mining scoped to "readers of this author's other books," which
 * is a stronger relevance signal than the general "customers also bought"
 * carousel for series/backlist keywords. Best-effort like scrapeProductPage.
 */
export async function scrapeAuthorCatalog(authorUrl: string, excludeAsin: string): Promise<string[]> {
  try {
    const res = await fetchWithTimeout(
      authorUrl,
      {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      PAGE_TIMEOUT_MS
    );
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);

    const titles = new Set<string>();
    $('a[href*="/dp/"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (!asinMatch || asinMatch[1].toUpperCase() === excludeAsin.toUpperCase()) return;

      const alt = $(el).find("img").attr("alt")?.trim();
      const text = alt || $(el).text().trim();
      if (text && text.length > 3) titles.add(text);
    });

    return Array.from(titles).slice(0, 15);
  } catch {
    return [];
  }
}
