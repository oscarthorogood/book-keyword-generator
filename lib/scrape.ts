import * as cheerio from "cheerio";
import { KeywordCandidate, Marketplace, ProductPageData, RelatedCompetitor, RelatedCompetitorCrawl } from "./types";

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

// Base terms plus format, series-order, and recency/bestseller modifiers —
// patterns confirmed against a real 30-day search term report (see the
// learnings doc): format ("hardcover"/"paperback"), series-order ("books in
// order"), and recency/bestseller intent ("best sellers"/"new release").
const AUTOCOMPLETE_MODIFIERS = [
  "book",
  "series",
  "novel",
  "audiobook",
  "kindle",
  "hardcover",
  "paperback",
  "books in order",
  "best sellers",
  "new release",
];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
// Suffix sweep (title + a..z) + prefix sweep (a..z + title) both cost a
// letter each, plus title/modifiers/author — see buildAutocompleteSeeds.
const MAX_AUTOCOMPLETE_SEEDS = 65;
const MAX_GOOGLE_SUGGEST_SEEDS = 20;
const AUTOCOMPLETE_CONCURRENCY = 15;

/**
 * Amazon's autocomplete returns different completions depending on the next
 * character typed, so sweeping a-z after the title ("<title> a", "<title>
 * b", ...) harvests far more real suggestions than the bare title alone — a
 * well-known free technique for multiplying yield from the same endpoint.
 * Also sweeps the *reverse* order ("a <title>", "b <title>", ...), which
 * catches modifier words that appear before the phrase instead of after it
 * (e.g. "dark sci fi romance") — a query shape the suffix sweep alone can't
 * reach. See the manual keyword research blueprint, section 2.
 */
export function buildAutocompleteSeeds(title: string, author?: string): string[] {
  const cleanTitle = title.trim();
  if (!cleanTitle) return [];

  const seeds = new Set<string>();
  seeds.add(cleanTitle);
  for (const modifier of AUTOCOMPLETE_MODIFIERS) seeds.add(`${cleanTitle} ${modifier}`);
  if (author) seeds.add(`${cleanTitle} ${author}`);
  for (const letter of ALPHABET) seeds.add(`${cleanTitle} ${letter}`);
  for (const letter of ALPHABET) seeds.add(`${letter} ${cleanTitle}`);

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

const EMPTY_PRODUCT_PAGE: ProductPageData = {
  compTitles: [],
  categories: [],
  compAsins: [],
  reviewSnippets: [],
};

/**
 * Amazon's product page often embeds a handful of top review excerpts
 * server-side (separate from the full paginated /product-reviews/ page,
 * which this app doesn't fetch to keep the request count down). These are
 * mined for recurring reader vocabulary — see lib/reviewMining.ts.
 */
function extractReviewSnippets($: cheerio.CheerioAPI): string[] {
  const snippets = new Set<string>();
  $('[data-hook="review-body"], [data-hook="review-collapsed"]').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text.length > 15) snippets.add(text);
  });
  return Array.from(snippets).slice(0, 20);
}

/**
 * Amazon's series widget shows text like "Book 3 of 12: Kill Squad" near the
 * byline — tries a few plausible selectors and strips the leading "Book N of
 * M:" prefix, since the naming convention wants the series name alone.
 */
function extractSeriesName($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    "#seriesBulletWidget_feature_div a",
    '[data-feature-name="seriesTitle"] a',
    "#series-title .a-size-medium",
    "#SeriesSubtitle a",
  ];

  for (const selector of selectors) {
    const raw = $(selector).first().text().replace(/\s+/g, " ").trim();
    if (!raw) continue;
    const stripped = raw.replace(/^book\s+\d+(\.\d+)?\s+of\s+\d+\s*:\s*/i, "").trim();
    if (stripped) return stripped;
  }
  return undefined;
}

/**
 * Best-effort list price scrape for prefilling the RRP field in the form.
 * Amazon shows several prices on one page (Kindle/paperback/hardcover); this
 * just grabs the first one found rather than picking a specific format, so
 * treat the prefilled value as a starting point to double-check, not a
 * guaranteed print RRP.
 */
function extractPrice($: cheerio.CheerioAPI): number | undefined {
  const selectors = [
    "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
    "#tmmSwatches .a-price .a-offscreen",
    ".a-price .a-offscreen",
  ];

  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    const match = text.match(/[\d,]+\.\d{2}/);
    if (!match) continue;
    const value = parseFloat(match[0].replace(/,/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

/**
 * Scrapes the book's own Amazon product page for title/author/ISBN/series/
 * price plus thematic context: "customers also bought" titles + their
 * ASINs, category/best-seller placement text, and review excerpts.
 * Best-effort — returns whatever it can find, empty arrays/undefined fields
 * on total failure.
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
    const author =
      $("#bylineInfo .author a, .author a.contributorNameID")
        .first()
        .text()
        .trim() || undefined;

    const { isbn10, isbn13 } = extractIsbns($);

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
      isbn10,
      isbn13,
      seriesName: extractSeriesName($),
      price: extractPrice($),
      compTitles: Array.from(compTitles).slice(0, 15),
      categories: Array.from(categories).slice(0, 15),
      compAsins: Array.from(compAsins).slice(0, 5),
      reviewSnippets: extractReviewSnippets($),
    };
  } catch {
    return EMPTY_PRODUCT_PAGE;
  }
}

const FIRST_HOP_ASIN_LIMIT = 5;
const SECOND_HOP_ASIN_LIMIT = 6;

/**
 * Approximates the manual research blueprint's "Best-Seller & Also Bought
 * Deep Dive" (section 3): follow the "customers also bought" trail out past
 * the immediate comp titles to find more direct competitors — author, title,
 * and ASIN for each — rather than stopping at one hop. Bounded to keep the
 * request count sane for a serverless function: up to 5 first-hop pages,
 * then up to 6 more second-hop pages found via *their* "also bought"
 * carousels. There's no way to automate the blueprint's "3-second rule"
 * (subgenre/tone/cover fit) — this surfaces candidates for the caller to
 * filter via source-agreement scoring, not a vetted competitor list.
 */
export async function scrapeRelatedCompetitors(
  seedAsin: string,
  compAsins: string[],
  marketplace: Marketplace
): Promise<RelatedCompetitorCrawl> {
  const firstHopAsins = compAsins.slice(0, FIRST_HOP_ASIN_LIMIT);
  if (firstHopAsins.length === 0) {
    return { categories: [], competitors: [], productTargetAsins: [] };
  }

  const firstHopPages = await mapWithConcurrency(firstHopAsins, firstHopAsins.length, (asin) =>
    scrapeProductPage(asin, marketplace)
  );

  const categories = new Set<string>();
  const competitors = new Map<string, RelatedCompetitor>();
  const secondHopCandidates = new Set<string>();

  firstHopAsins.forEach((asin, i) => {
    const page = firstHopPages[i];
    for (const category of page.categories) categories.add(category);
    if (page.title || page.author) competitors.set(asin, { asin, author: page.author, title: page.title });
    for (const compAsin of page.compAsins) {
      if (compAsin !== seedAsin && !firstHopAsins.includes(compAsin)) secondHopCandidates.add(compAsin);
    }
  });

  const secondHopAsins = Array.from(secondHopCandidates).slice(0, SECOND_HOP_ASIN_LIMIT);
  if (secondHopAsins.length > 0) {
    const secondHopPages = await mapWithConcurrency(secondHopAsins, secondHopAsins.length, (asin) =>
      scrapeProductPage(asin, marketplace)
    );
    secondHopAsins.forEach((asin, i) => {
      const page = secondHopPages[i];
      if (page.title || page.author) competitors.set(asin, { asin, author: page.author, title: page.title });
    });
  }

  return {
    categories: Array.from(categories),
    competitors: Array.from(competitors.values()),
    productTargetAsins: [...firstHopAsins, ...secondHopAsins],
  };
}
