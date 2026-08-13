import * as cheerio from "cheerio";
import { mapWithConcurrency } from "./concurrency";
import { HostBlockedError, withRateLimit } from "./fetchLog";
import { parseCountText, parsePriceText } from "./numberText";
import { type AmazonPageMetadata } from "./firecrawl";
import { extractListingHtmlMetadata, fallbackFormats } from "./listingMetadata";
import { fetchAmazonProductViaSerpApi, isSerpApiConfigured } from "./serpApi";
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

const SCRAPER_PROXY_COUNTRY: Record<Marketplace, string> = {
  US: "us",
  CA: "ca",
  UK: "gb",
  DE: "de",
  FR: "fr",
  IT: "it",
  ES: "es",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Amazon blocks/CAPTCHAs product-page requests from datacenter IPs (Vercel,
// AWS, etc.) at the network level — see lib/scrape.ts's looksLikeBotCheck.
// When set, routes full-page HTML fetches (scrapeProductPage, and
// lib/goodreads.ts) through ScraperAPI's residential/rotating-IP proxy
// instead of hitting the target directly. NOT applied to the autocomplete
// JSON endpoints below — those run dozens of times per generate call, which
// would burn through a proxy's free tier fast, and it's unconfirmed whether
// they're even blocked the same way. Unset (local dev, usually a
// residential IP) falls back to a direct fetch everywhere.
export const SCRAPER_PROXY_API_KEY = process.env.SCRAPER_PROXY_API_KEY;

// Alternative proxy provider — same purpose as SCRAPER_PROXY_API_KEY above,
// swapped in when preferred (e.g. better Amazon success rate on ScraperAPI's
// free tier). When both are set, ScrapingBee takes priority.
export const SCRAPINGBEE_API_KEY = process.env.SCRAPINGBEE_API_KEY;

export const SCRAPER_PROXY_CONFIGURED = Boolean(SCRAPINGBEE_API_KEY || SCRAPER_PROXY_API_KEY);

/** Generic proxy URL wrapper — pass a country_code when the target is country-specific (e.g. an Amazon marketplace domain). Prefers ScrapingBee over ScraperAPI when both are configured. */
export function resolveScraperProxyUrl(targetUrl: string, countryCode?: string): string {
  if (SCRAPINGBEE_API_KEY) {
    const params = new URLSearchParams({
      api_key: SCRAPINGBEE_API_KEY,
      url: targetUrl,
      render_js: "false",
    });
    if (countryCode) params.set("country_code", countryCode);
    return `https://app.scrapingbee.com/api/v1/?${params.toString()}`;
  }
  if (!SCRAPER_PROXY_API_KEY) return targetUrl;
  const params = new URLSearchParams({ api_key: SCRAPER_PROXY_API_KEY, url: targetUrl });
  if (countryCode) params.set("country_code", countryCode);
  return `https://api.scraperapi.com/?${params.toString()}`;
}

export const PAGE_TIMEOUT_MS = 8000;
// Proxied requests add relay latency on top of the target site's own response time.
export const PROXIED_PAGE_TIMEOUT_MS = 20000;
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

export interface PageFetchResult {
  html?: string;
  status?: number;
  /** True when the response was Amazon's bot/CAPTCHA interstitial rather than the page. */
  blocked: boolean;
  /** True when the host is inside a CAPTCHA cool-down and nothing was requested. */
  skipped?: boolean;
}

/**
 * The one way this module fetches an HTML page. Everything goes through the
 * shared rate limiter and audit log (lib/fetchLog.ts): requests to the same
 * host are spaced out and capped, every attempt is logged with its status
 * and duration, and a bot check trips a per-host cool-down so a blocked host
 * is left alone instead of being hammered. Never throws — a block, a
 * non-2xx, a timeout and a cool-down all come back as an empty result the
 * caller degrades from.
 */
export async function fetchPageHtml(
  url: string,
  options: { timeoutMs?: number; proxyCountry?: string; label?: string } = {}
): Promise<PageFetchResult> {
  const fetchUrl = resolveScraperProxyUrl(url, options.proxyCountry);
  const timeoutMs = options.timeoutMs ?? (SCRAPER_PROXY_CONFIGURED ? PROXIED_PAGE_TIMEOUT_MS : PAGE_TIMEOUT_MS);

  try {
    // Rate limiting is keyed on the *target* host, not the proxy's, so
    // routing through ScraperAPI doesn't quietly remove the spacing.
    return await withRateLimit(url, async () => {
      const res = await fetchWithTimeout(
        fetchUrl,
        {
          headers: {
            "User-Agent": USER_AGENT,
            Accept: "text/html,application/xhtml+xml",
            "Accept-Language": "en-US,en;q=0.9",
          },
        },
        timeoutMs
      );

      if (!res.ok) {
        return { value: { blocked: false, status: res.status } as PageFetchResult, status: res.status, note: options.label };
      }

      const html = await res.text();
      if (looksLikeBotCheck(html)) {
        return {
          value: { blocked: true, status: res.status } as PageFetchResult,
          status: res.status,
          blocked: true,
          note: options.label,
        };
      }

      return { value: { html, blocked: false, status: res.status } as PageFetchResult, status: res.status, note: options.label };
    });
  } catch (err) {
    if (err instanceof HostBlockedError) {
      return { blocked: true, skipped: true };
    }
    console.error(`[fetchPageHtml] ${url} threw:`, err instanceof Error ? err.message : err);
    return { blocked: false };
  }
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

// Format-specific search queries
const SEARCH_FORMATS = [
  "ebook",
  "audio",
  "boxset",
  "omnibus",
  "edition",
  "complete",
];
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");
// Suffix sweep (title + a..z) plus title/genre/modifier/author seeds — see
// buildAutocompleteSeeds. The sweep is added last, so this cap decides how
// much of the alphabet actually gets swept.
const MAX_AUTOCOMPLETE_SEEDS = 80;
const MAX_GOOGLE_SUGGEST_SEEDS = 20;
const AUTOCOMPLETE_CONCURRENCY = 15;

/**
 * Extra autocomplete seeds derived from Firecrawl's structured extraction
 * (categories, marketing features, the genre/trope phrases it surfaces), for
 * category- and feature-specific searches the title sweep never reaches.
 *
 * Pure: the extraction itself is fetched once during snapshot capture
 * (lib/bookSnapshot.ts) and passed in, rather than each consumer paying for
 * its own Firecrawl call.
 */
export function buildSeedsFromMetadata(metadata: AmazonPageMetadata): string[] {
  const seeds = new Set<string>();

  if (metadata.categories && metadata.categories.length > 0) {
    const mainCategory = metadata.categories[metadata.categories.length - 1];
    seeds.add(mainCategory);
    if (metadata.title) seeds.add(`${metadata.title} ${mainCategory}`.slice(0, 100));
  }

  // Marketing bullets are sentences; only the short ones read like a query.
  for (const feature of (metadata.features ?? []).slice(0, 3)) {
    const words = feature.split(/\s+/).filter((w) => w.length > 3);
    if (words.length > 0 && words.length <= 3) seeds.add(words.join(" "));
  }

  for (const keyword of (metadata.keywords ?? []).slice(0, 8)) {
    if (keyword.length > 2 && keyword.length < 50) seeds.add(keyword);
  }

  if (metadata.series) {
    seeds.add(metadata.series);
    seeds.add(`${metadata.series} series`);
  }

  if (metadata.language && metadata.language.toLowerCase() !== "english" && metadata.title) {
    seeds.add(`${metadata.title} ${metadata.language}`);
  }

  return Array.from(seeds).filter((s) => s.length > 2 && s.length < 100);
}

/**
 * Amazon's autocomplete returns different completions depending on the next
 * character typed, so sweeping a-z after the title ("<title> a", "<title>
 * b", ...) harvests far more real suggestions than the bare title alone — a
 * well-known free technique for multiplying yield from the same endpoint.
 * See the manual keyword research blueprint, section 2.
 *
 * Genre seeds come from the book's own resolved genre vocabulary
 * (lib/genre.ts, captured in the book snapshot), not from a fixed list. The
 * fixed list used to be thriller/mystery/crime/detective, which meant every
 * romance, cookbook and memoir in the library got seeded with
 * "<title> thriller" and then generated thriller keywords off the back of
 * whatever Amazon suggested for it.
 */
export function buildAutocompleteSeeds(params: {
  title: string;
  author?: string;
  genreTerms?: string[];
  seriesName?: string;
}): string[] {
  const cleanTitle = params.title.trim();
  const author = params.author?.trim();
  const genreTerms = (params.genreTerms ?? []).filter(Boolean);
  if (!cleanTitle && genreTerms.length === 0) return [];

  const seeds = new Set<string>();
  const add = (seed: string) => {
    const trimmed = seed.trim();
    if (trimmed.length > 2) seeds.add(trimmed);
  };

  if (cleanTitle) add(cleanTitle);

  // Title fragments — long or compound titles rarely autocomplete in full.
  const titleWords = cleanTitle.split(/\s+/).filter((w) => w.length > 2);
  if (titleWords.length > 1) {
    add(titleWords.slice(0, Math.min(3, titleWords.length)).join(" "));
    add(titleWords.slice(-Math.min(3, titleWords.length)).join(" "));
  }

  // Format / series-order / recency modifiers on the title.
  if (cleanTitle) {
    for (const modifier of AUTOCOMPLETE_MODIFIERS) add(`${cleanTitle} ${modifier}`);
    for (const format of SEARCH_FORMATS) add(`${cleanTitle} ${format}`);
  }

  // The book's real genres, on their own and crossed with title/author. Genre
  // seeds alone are what surface category-level demand ("cozy mystery series"),
  // which the title-only sweep never reaches.
  for (const genre of genreTerms) {
    add(genre);
    add(`${genre} books`);
    if (cleanTitle) add(`${cleanTitle} ${genre}`);
    if (author) add(`${author} ${genre}`);
  }

  if (params.seriesName) {
    add(params.seriesName);
    add(`${params.seriesName} series`);
    add(`${params.seriesName} books in order`);
  }

  if (author) {
    add(author);
    add(`${author} books`);
    add(`${author} books in order`);
    if (cleanTitle) add(`${cleanTitle} ${author}`);
    const authorWords = author.split(/\s+/);
    if (authorWords.length > 1) {
      add(authorWords[0]);
      add(`${authorWords[0]} books`);
    }
  }

  // Full a-z suffix sweep last: whatever budget is left after the targeted
  // seeds above goes to exhaustive coverage.
  if (cleanTitle) {
    for (const letter of ALPHABET) add(`${cleanTitle} ${letter}`);
  }

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
 * Includes retry logic for seeds that don't return results on first try.
 */
export async function getAutocompleteKeywordSet(
  seedTerms: string[],
  marketplace: Marketplace
): Promise<KeywordCandidate[]> {
  const results = await mapWithConcurrency(seedTerms, AUTOCOMPLETE_CONCURRENCY, (term) =>
    getAutocompleteSuggestions(term, marketplace)
  );

  const allResults = results.flat();

  // If we got very few results, try simpler seed variations
  if (allResults.length < 3 && seedTerms.length > 0) {
    const simpleSeeds = seedTerms
      .map(t => t.split(/\s+/).slice(0, 1).join("")) // First word only
      .filter((t, i, arr) => arr.indexOf(t) === i && t.length > 0); // Deduplicate

    if (simpleSeeds.length > 0) {
      const simpleResults = await mapWithConcurrency(simpleSeeds.slice(0, 5), AUTOCOMPLETE_CONCURRENCY, (term) =>
        getAutocompleteSuggestions(term, marketplace)
      );
      allResults.push(...simpleResults.flat());
    }
  }

  return allResults;
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

function extractAuthorBio($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    '.a-span-last .contribution [data-a-expander-name="book_description_expander"]',
    '[data-a-expander-name="author_byline_expander"]',
    '.a-container [data-a-expander-name="author"]',
  ];

  for (const selector of selectors) {
    const text = $(selector).text().replace(/\s+/g, " ").trim();
    if (text && text.length > 20) return text;
  }
  return undefined;
}

function extractAuthorImage($: cheerio.CheerioAPI): string | undefined {
  const src = $("#bylineInfo img").attr("src");
  return src || undefined;
}

function extractFormatVariants($: cheerio.CheerioAPI): Array<{ format: string; price?: number; asin?: string }> {
  const formats: Array<{ format: string; price?: number; asin?: string }> = [];

  // Look for format toggles (Kindle, Hardcover, Paperback, etc.)
  $(".a-tabs-container [role='tab']").each((_, el) => {
    const text = $(el).text().trim();
    if (text && (text.includes("Kindle") || text.includes("Hardcover") || text.includes("Paperback") || text.includes("Audio"))) {
      formats.push({ format: text });
    }
  });

  return formats;
}

function extractEditionInfo($: cheerio.CheerioAPI): { edition?: string; bindingType?: string } {
  const result: { edition?: string; bindingType?: string } = {};

  $("#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();

    if (/^Edition/.test(text)) {
      const match = text.match(/Edition[^;]*[;:]?\s*([^;(]+)/i);
      if (match) result.edition = match[1].trim();
    }

    if (/^Binding|Hardcover|Paperback|Board Book/.test(text)) {
      const match = text.match(/(Hardcover|Paperback|Board Book|Leather Bound|Spiral-bound)/);
      if (match) result.bindingType = match[1];
    }
  });

  return result;
}

function extractWordCount($: cheerio.CheerioAPI): number | undefined {
  const text = $("body").text();
  const match = text.match(/(\d+(?:,\d{3})*)\s*words/i);
  if (match) {
    return parseInt(match[1].replace(/,/g, ""), 10);
  }
  return undefined;
}

function extractLexileLevel($: cheerio.CheerioAPI): string | undefined {
  const text = $("#detailBulletsWrapper_feature_div, #productDetails_detailBullets_sections1").text();
  const match = text.match(/Lexile[^:]*:\s*([\dL\-]+)/i);
  return match ? match[1].trim() : undefined;
}

function extractAgeRange($: cheerio.CheerioAPI): string | undefined {
  const text = $("#detailBulletsWrapper_feature_div, #productDetails_detailBullets_sections1").text();
  const match = text.match(/(?:Ages?|Grade|Reading Level)[^:]*:\s*([^;]+)/i);
  return match ? match[1].trim() : undefined;
}

function extractCopyrightYear($: cheerio.CheerioAPI): number | undefined {
  const text = $("body").text();
  const match = text.match(/©\s*(\d{4})/);
  if (match) {
    return parseInt(match[1], 10);
  }
  return undefined;
}

function extractRatingDistribution($: cheerio.CheerioAPI): Array<{ stars: number; count: number }> {
  const distribution: Array<{ stars: number; count: number }> = [];

  $('[data-star-count]').each((_, el) => {
    const starText = $(el).attr("data-star-count");
    const countText = $(el).closest('tr').find('a').text();

    if (starText && countText) {
      const stars = parseInt(starText, 10);
      const count = parseInt(countText.replace(/[^0-9]/g, ''), 10);
      if (Number.isFinite(stars) && Number.isFinite(count)) {
        distribution.push({ stars, count });
      }
    }
  });

  return distribution;
}

function extractFrequentlyBoughtTogether($: cheerio.CheerioAPI): Array<{ asin: string; title: string }> {
  const items: Array<{ asin: string; title: string }> = [];

  $('[data-a-carousel-options*="frequently-bought-together"] a[href*="/dp/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      const title = $(el).find("img").attr("alt") || $(el).text().trim();
      if (title) {
        items.push({ asin: asinMatch[1].toUpperCase(), title });
      }
    }
  });

  return items.slice(0, 10);
}

function extractCompareWithSimilar($: cheerio.CheerioAPI): Array<{ asin: string; title: string }> {
  const items: Array<{ asin: string; title: string }> = [];

  $('[id*="compare"], [data-component-type="s-compare-side-by-side"] a[href*="/dp/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/i);
    if (asinMatch) {
      const title = $(el).text().trim();
      if (title) {
        items.push({ asin: asinMatch[1].toUpperCase(), title });
      }
    }
  });

  return items.slice(0, 10);
}

function extractAwards($: cheerio.CheerioAPI): { awards: string[]; nominations: string[] } {
  const awards: string[] = [];
  const nominations: string[] = [];

  $(".a-section .a-size-small, [data-a-badge-type*='award']").each((_, el) => {
    const text = $(el).text().trim();
    if (text && (text.includes("Award") || text.includes("Winner") || text.includes("Bestseller"))) {
      if (text.includes("Nominated")) {
        nominations.push(text);
      } else {
        awards.push(text);
      }
    }
  });

  return { awards, nominations };
}

function extractContentWarnings($: cheerio.CheerioAPI): string[] {
  const warnings: string[] = [];

  const text = $(".a-section").text().toLowerCase();
  const warningKeywords = [
    "violence", "graphic", "trigger", "warning", "mature", "adult content",
    "sexual content", "abuse", "self-harm", "suicide", "dark"
  ];

  warningKeywords.forEach(keyword => {
    if (text.includes(keyword)) {
      warnings.push(keyword.charAt(0).toUpperCase() + keyword.slice(1));
    }
  });

  return [...new Set(warnings)];
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

/**
 * The shape a failed page read returns: every list empty, every field
 * undefined. Exported so a caller that abandons the scrape on a deadline can
 * fall back to the same value the scraper itself would have returned.
 */
export const EMPTY_PRODUCT_PAGE: ProductPageData = {
  compTitles: [],
  compDetails: [],
  categories: [],
  categoryPath: [],
  bestSellerRanks: [],
  compAsins: [],
  reviewSnippets: [],
  bulletPoints: [],
  authorOtherBooks: [],
  formatVariants: [],
  previewImages: [],
  frequentlyBoughtTogether: [],
  compareWithSimilar: [],
  seriesBooks: [],
  ratingDistribution: [],
  allCategoryRanks: [],
  tableOfContents: [],
  contentWarnings: [],
  languages: [],
  deliveryOptions: [],
  awards: [],
  awardNominations: [],
};

function resolveAmazonUrl(href: string, domain: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `https://www.${domain}${href.startsWith("/") ? "" : "/"}${href}`;
}

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
 * The publisher/author's own blurb — never looked at before this. Explicit
 * comp mentions in here ("perfect for fans of X") are a high-confidence
 * signal; see buildDescriptionCandidates in lib/keywordMerge.ts.
 */
function extractDescription($: cheerio.CheerioAPI): string | undefined {
  const text = $("#bookDescription_feature_div").first().text().replace(/\s+/g, " ").trim();
  return text || undefined;
}

/** Amazon's "About this item" feature bullets — often short marketing phrases in their own right, not just sentence fragments. */
function extractBulletPoints($: cheerio.CheerioAPI): string[] {
  const bullets = new Set<string>();
  $("#feature-bullets li span.a-list-item").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) bullets.add(text);
  });
  return Array.from(bullets).slice(0, 15);
}

function extractRating($: cheerio.CheerioAPI): number | undefined {
  const selectors = [
    '.a-icon-star-small span, [data-a-icon-prime-external] .a-icon-star .a-icon-star-small span',
    '.a-star-small span',
    '[aria-label*="out of 5"]',
  ];

  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    const match = text.match(/(\d+\.?\d*)\s*out of|^(\d+\.?\d*)/);
    if (match) {
      const value = parseFloat(match[1] || match[2]);
      if (Number.isFinite(value) && value > 0 && value <= 5) return value;
    }
  }
  return undefined;
}

function extractReviewCount($: cheerio.CheerioAPI): number | undefined {
  const selectors = [
    '#acrCustomerReviewText',
    '[aria-label*="customer ratings"]',
    '[data-hook="total-review-count"]',
  ];

  for (const selector of selectors) {
    const value = parseCountText($(selector).first().text().trim());
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractProductDetails($: cheerio.CheerioAPI): { pageCount?: number; publisher?: string; publicationDate?: string; language?: string; dimensions?: string } {
  const result: { pageCount?: number; publisher?: string; publicationDate?: string; language?: string; dimensions?: string } = {};

  // Try multiple detail table structures
  $('#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr, .a-keyvalue').each((_, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();

    // Pages
    if (/^\s*(?:Number of pages|Pages)\s*:\s*/.test(text)) {
      const match = text.match(/(\d+)\s*pages?/i);
      if (match) result.pageCount = parseInt(match[1], 10);
    }

    // Publisher
    if (/^\s*Publisher\s*/.test(text)) {
      const match = text.match(/Publisher[^;]*;\s*([^;(]+)/i);
      if (match) result.publisher = match[1].trim();
    }

    // Publication date
    if (/^\s*(?:Publication[_ ]Date|Release[_ ]Date)\s*/.test(text)) {
      const match = text.match(/(?:Publication|Release)\s*(?:Date)?\s*[;:]?\s*(.+?)(?:;|$)/i);
      if (match) result.publicationDate = match[1].trim();
    }

    // Language
    if (/^\s*Language\s*/.test(text)) {
      const match = text.match(/Language[^;]*:\s*([^;]+)/i);
      if (match) result.language = match[1].trim();
    }

    // Dimensions
    if (/^\s*(?:Dimensions|Product Dimensions)\s*/.test(text)) {
      const match = text.match(/Dimensions[^;]*:\s*(.+?)(?:Shipping Weight|$)/i);
      if (match) result.dimensions = match[1].trim();
    }
  });

  return result;
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
    const value = parsePriceText($(selector).first().text().trim());
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractOriginalPrice($: cheerio.CheerioAPI): number | undefined {
  const selectors = [
    ".a-price.a-text-strike .a-offscreen",
    "[data-a-strike='true'] .a-offscreen",
    ".a-text-strike .a-offscreen",
  ];

  for (const selector of selectors) {
    const value = parsePriceText($(selector).first().text().trim());
    if (value !== undefined) return value;
  }
  return undefined;
}

function extractPrimeEligible($: cheerio.CheerioAPI): boolean {
  const primeIndicators = $('[aria-label*="Prime"]').length > 0 ||
                          $('[data-feature-name="prime"]').length > 0 ||
                          $('[class*="prime"]').length > 0;
  return primeIndicators;
}

function extractStockStatus($: cheerio.CheerioAPI): "In Stock" | "Out of Stock" | "Pre-order" | "Unknown" | undefined {
  const availability = $("#availability span").text().trim();
  if (availability.includes("Out of Stock")) return "Out of Stock";
  if (availability.includes("In Stock")) return "In Stock";
  if (availability.includes("Pre-order")) return "Pre-order";
  return undefined;
}

function extractAmazonBadges($: cheerio.CheerioAPI): { amazonChoice: boolean; bestseller: boolean } {
  const amazonChoice = $('[data-a-badge-type="standard"]').text().includes("Choice") ||
                       $('[aria-label*="Amazon Choice"]').length > 0;
  const bestseller = $('[aria-label*="Best"]').text().includes("Seller") ||
                     $('[class*="best"]').text().includes("seller");
  return { amazonChoice, bestseller };
}

function extractHasLookInside($: cheerio.CheerioAPI): boolean {
  return $('[data-feature-name="look-inside"]').length > 0 ||
         $("a:contains('Look inside')").length > 0;
}

function extractFormatFlags($: cheerio.CheerioAPI): {
  hasAudiobook: boolean;
  hasKindle: boolean;
  hasPhysical: boolean;
  hasHardcover: boolean;
  hasPaperback: boolean;
} {
  const pageText = $("body").text().toLowerCase();
  const hrefText = $("a").map((_, el) => $(el).attr("href") || "").get().join("");

  return {
    hasAudiobook: /audiobook|audible|narrated/i.test(hrefText + pageText),
    hasKindle: /kindle|ebook/i.test(hrefText + pageText),
    hasPhysical: /hardcover|paperback|print|physical/i.test(hrefText + pageText),
    hasHardcover: /hardcover/i.test(hrefText + pageText),
    hasPaperback: /paperback/i.test(hrefText + pageText),
  };
}

function extractTableOfContents($: cheerio.CheerioAPI): string[] {
  const toc: string[] = [];

  $('[data-a-expander-name="table_of_contents"] li, .a-expander-content li').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 2 && !text.includes("...")) {
      toc.push(text);
    }
  });

  return toc.slice(0, 30);
}

function extractLanguages($: cheerio.CheerioAPI): string[] {
  const languages: string[] = [];

  $("#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (/^Language/.test(text)) {
      const matches = text.match(/Language[^:]*[;:]?\s*([^;]+)/i);
      if (matches) {
        const langs = matches[1].split(/,|and/).map(l => l.trim());
        languages.push(...langs.filter(l => l.length > 0));
      }
    }
  });

  return [...new Set(languages)];
}

function extractDiscountInfo($: cheerio.CheerioAPI): { originalPrice?: number; discountPercentage?: number } {
  const result: { originalPrice?: number; discountPercentage?: number } = {};

  // Shares the multi-selector strike-through lookup rather than repeating a
  // single-selector copy of it here.
  result.originalPrice = extractOriginalPrice($);

  const discountText = $(".savingsPercent").text();
  if (discountText) {
    const match = discountText.match(/(\d+)%/);
    if (match) result.discountPercentage = parseInt(match[1], 10);
  }

  return result;
}

/** Book cover image URL — tries multiple selectors for different Amazon templates. */
function extractCoverImageUrl($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    "#landingImage",
    "#ebooksImageContainer img",
    ".a-dynamic-image",
    '[data-a-dynamic-image]',
  ];

  for (const selector of selectors) {
    const el = $(selector).first();
    let src = el.attr("src");
    if (!src) src = el.attr("data-src");
    if (!src) {
      const dynamicAttr = el.attr("data-a-dynamic-image");
      if (dynamicAttr) {
        try {
          const parsed = JSON.parse(dynamicAttr) as Record<string, unknown>;
          const firstUrl = Object.keys(parsed)[0];
          if (firstUrl) src = firstUrl;
        } catch {
          // ignore JSON parse errors
        }
      }
    }
    if (src) return src;
  }
  return undefined;
}

/** Q&A count from the product page — appears in the Q&A section header. */
function extractQaCount($: cheerio.CheerioAPI): number | undefined {
  const selectors = [
    '[data-hook="ask-header-count"]',
    '#ask-section [data-a-count]',
    '.a-section.a-spacing-medium:contains("Customer Questions")',
  ];

  for (const selector of selectors) {
    const value = parseCountText($(selector).first().text().trim());
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Availability status text (e.g., "In Stock", "Usually ships within 1-2 weeks"). */
function extractAvailability($: cheerio.CheerioAPI): string | undefined {
  const selectors = [
    '#availability span',
    '[data-feature-name="availability"] span',
    '.availability',
  ];

  for (const selector of selectors) {
    const text = $(selector).first().text().replace(/\s+/g, ' ').trim();
    if (text) return text;
  }
  return undefined;
}

// Amazon serves a "Robot Check"/CAPTCHA interstitial instead of the real
// page when it flags the request as automated — routine for cloud/datacenter
// IPs (Vercel, AWS, etc.), much rarer from a residential IP. Detecting it
// distinctly from "page structure changed" or "network failure" is the
// difference between a fixable bug and a hosting-environment problem.
const BOT_CHECK_PATTERNS = [
  /to discuss automated access to amazon data/i,
  /enter the characters you see below/i,
  /type the characters you see in this image/i,
  /api-services-support@amazon/i,
];

function looksLikeBotCheck(html: string): boolean {
  return BOT_CHECK_PATTERNS.some((pattern) => pattern.test(html));
}

/**
 * Scrapes the book's own Amazon product page for title/author/ISBN/series/
 * price plus thematic context: "customers also bought" titles + their
 * ASINs, category/best-seller placement text, and review excerpts.
 * Best-effort — returns whatever it can find, empty arrays/undefined fields
 * on total failure. Logs the reason server-side (HTTP status / bot-check
 * detection / thrown error) since scrape failures are otherwise silent.
 */
export function getProductPageUrl(asin: string, marketplace: Marketplace): string {
  const domain = AMAZON_DOMAINS[marketplace];
  return `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
}

async function scrapeProductPageDirect(
  asin: string,
  marketplace: Marketplace
): Promise<ProductPageData> {
  const url = getProductPageUrl(asin, marketplace);
  const logPrefix = `[scrapeProductPage] ${asin} (${marketplace})`;

  try {
    const page = await fetchPageHtml(url, {
      proxyCountry: SCRAPER_PROXY_COUNTRY[marketplace],
      label: `product page ${asin}`,
    });

    if (page.blocked) {
      console.error(
        `${logPrefix} -> ${page.skipped ? "skipped, host in bot-check cool-down" : "response looks like an Amazon bot/CAPTCHA check"}`
      );
      return { ...EMPTY_PRODUCT_PAGE, fetchStatus: page.status, blocked: true };
    }
    if (!page.html) {
      console.error(`${logPrefix} -> no HTML (HTTP ${page.status ?? "n/a"})`);
      return { ...EMPTY_PRODUCT_PAGE, fetchStatus: page.status };
    }

    const $ = cheerio.load(page.html);

    // Selector-drift signal: the title is the field every other extraction
    // depends on, so a page that loads without one is logged distinctly from
    // a page that never loaded.
    const title = $("#productTitle").first().text().trim() || undefined;
    if (!title) {
      console.error(`${logPrefix} -> HTTP ${page.status}, page loaded but #productTitle not found (selector drift, or a partial/soft block)`);
    }

    // HTML-level metadata: <title>, meta keywords/description, canonical URL
    // slug, JSON-LD, variation swatches, and which editions actually exist.
    const listingMetadata = extractListingHtmlMetadata($, url);
    const authorLink = $("#bylineInfo .author a, .author a.contributorNameID").first();
    const author = authorLink.text().trim() || undefined;
    const authorHref = authorLink.attr("href");
    const authorUrl = authorHref ? resolveAmazonUrl(authorHref, AMAZON_DOMAINS[marketplace]) : undefined;

    const { isbn10, isbn13 } = extractIsbns($);

    const compTitles = new Set<string>();
    const compAsins = new Set<string>();
    const compDetails: Array<{ asin: string; title: string; author?: string; rating?: number; reviewCount?: number }> = [];

    $(
      '[data-a-carousel-options*="also-bought"] a[href*="/dp/"], [id*="similarities"] a[href*="/dp/"], .a-carousel-card a[href*="/dp/"]'
    ).each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/i);
      if (asinMatch && asinMatch[1].toUpperCase() !== asin.toUpperCase()) {
        const compAsin = asinMatch[1].toUpperCase();
        compAsins.add(compAsin);

        const alt = $(el).find("img").attr("alt")?.trim();
        const title = alt || $(el).text().trim();
        if (title && title.length > 3) {
          compTitles.add(title);
          compDetails.push({ asin: compAsin, title });
        }
      }
    });

    const categories = new Set<string>();
    // Ordered breadcrumb trail — Amazon's own hierarchy order, so the last
    // couple of entries approximate genre -> subgenre without us having to
    // guess at depth (categories go 2-5 levels deep depending on the node).
    const categoryPath: string[] = [];
    $("#wayfinding-breadcrumbs_feature_div a").each((_, el) => {
      const text = $(el).text().trim();
      if (text) {
        categories.add(text);
        categoryPath.push(text);
      }
    });
    $("#detailBulletsWrapper_feature_div a").each((_, el) => {
      const text = $(el).text().trim();
      if (text) categories.add(text);
    });

    // Best Sellers Rank — capturing the rank number, not just the category
    // name, so the app can show "this book is #12 in Cozy Mystery" rather
    // than just the category itself.
    const bestSellerRanks: { rank: number; category: string }[] = [];
    $("#detailBulletsWrapper_feature_div li, #productDetails_detailBullets_sections1 tr").each(
      (_, el) => {
        const text = $(el).text().replace(/\s+/g, " ").trim();
        if (/Best Sellers Rank/i.test(text)) {
          const matches = text.matchAll(/#([\d,]+)\s+in\s+([A-Za-z0-9 &'\-]+)/g);
          for (const m of matches) {
            const category = m[2].trim();
            categories.add(category);
            const rank = parseInt(m[1].replace(/,/g, ""), 10);
            if (Number.isFinite(rank)) bestSellerRanks.push({ rank, category });
          }
        }
      }
    );

    const details = extractProductDetails($);
    const { amazonChoice, bestseller } = extractAmazonBadges($);
    const { hasAudiobook, hasKindle, hasPhysical, hasHardcover, hasPaperback } = extractFormatFlags($);
    const { awards, nominations } = extractAwards($);
    const { originalPrice, discountPercentage } = extractDiscountInfo($);
    const editionInfo = extractEditionInfo($);
    const languages = extractLanguages($);

    return {
      title,
      author,
      authorUrl,
      authorBio: extractAuthorBio($),
      authorImage: extractAuthorImage($),
      authorOtherBooks: [],
      illustrator: undefined,
      narrator: undefined,
      isbn10,
      isbn13,
      seriesName: extractSeriesName($),
      price: extractPrice($),
      originalPrice,
      discountPercentage,
      primeEligible: extractPrimeEligible($),
      isDeal: !!(discountPercentage && discountPercentage > 0),
      format: undefined,
      edition: editionInfo.edition,
      bindingType: editionInfo.bindingType,
      formatVariants: extractFormatVariants($),
      coverImageUrl: extractCoverImageUrl($),
      authorImageUrl: extractAuthorImage($),
      previewImages: [],
      customerImageCount: undefined,
      customerVideoCount: undefined,
      compTitles: Array.from(compTitles).slice(0, 15),
      compDetails: compDetails.slice(0, 15),
      compAsins: Array.from(compAsins).slice(0, 5),
      frequentlyBoughtTogether: extractFrequentlyBoughtTogether($),
      compareWithSimilar: extractCompareWithSimilar($),
      seriesBooks: [],
      rating: extractRating($),
      reviewCount: extractReviewCount($),
      qaCount: extractQaCount($),
      ratingDistribution: extractRatingDistribution($),
      verifiedPurchasePercentage: undefined,
      categories: Array.from(categories).slice(0, 15),
      categoryPath,
      bestSellerRanks: bestSellerRanks.slice(0, 10),
      allCategoryRanks: bestSellerRanks,
      amazonChoiceBadge: amazonChoice,
      bestsellerBadge: bestseller,
      reviewSnippets: extractReviewSnippets($),
      description: extractDescription($),
      bulletPoints: extractBulletPoints($),
      tableOfContents: extractTableOfContents($),
      wordCount: extractWordCount($),
      lexileLevel: extractLexileLevel($),
      ageRange: extractAgeRange($),
      contentWarnings: extractContentWarnings($),
      readingLevel: extractLexileLevel($), // Alias for lexileLevel
      publisher: details.publisher,
      publicationDate: details.publicationDate,
      copyrightYear: extractCopyrightYear($),
      firstPublishedDate: details.publicationDate,
      pageCount: details.pageCount,
      language: details.language,
      languages,
      dimensions: details.dimensions,
      weight: undefined,
      availability: extractAvailability($),
      stockStatus: extractStockStatus($),
      deliveryOptions: [],
      hasLookInside: extractHasLookInside($),
      isPreOrder: undefined,
      preOrderDate: undefined,
      hasAudiobook,
      hasKindle,
      hasPhysical,
      hasHardcover,
      hasPaperback,
      awards,
      awardNominations: nominations,
      goodreadsRating: undefined,
      goodreadsRatingCount: undefined,
      htmlTitle: listingMetadata.htmlTitle,
      metaKeywords: listingMetadata.metaKeywords,
      metaDescription: listingMetadata.metaDescription,
      urlSlug: listingMetadata.urlSlug,
      brand: listingMetadata.brand,
      variations: listingMetadata.variations,
      structuredData: listingMetadata.structuredData,
      // The swatch strip is authoritative; the binding/edition rows only fill
      // in when it didn't render. A page-wide search for "hardcover" would
      // claim every listing has every format (see lib/listingMetadata.ts).
      availableFormats:
        listingMetadata.availableFormats.length > 0
          ? listingMetadata.availableFormats
          : fallbackFormats({
              bindingType: editionInfo.bindingType,
              formatVariants: extractFormatVariants($),
            }),
      isKindleUnlimited: listingMetadata.isKindleUnlimited,
      extractionFieldsFound: listingMetadata.fieldsFound,
      extractionFieldsMissing: listingMetadata.fieldsMissing,
      fetchStatus: page.status,
    };
  } catch (err) {
    console.error(`${logPrefix} -> fetch threw:`, err instanceof Error ? err.message : err);
    return EMPTY_PRODUCT_PAGE;
  }
}

/**
 * Scrapes the book's own Amazon product page for title/author/ISBN/series/
 * price plus thematic context: "customers also bought" titles + their
 * ASINs, category/best-seller placement text, and review excerpts.
 * Best-effort — returns whatever it can find, empty arrays/undefined fields
 * on total failure.
 *
 * When the direct scrape gets bot-checked (or otherwise comes back with no
 * title), supplements from SerpApi's Amazon Product API if configured —
 * same rationale as lib/amazonLookup.ts's autofill path: SerpApi fetches
 * from its own infrastructure, sidestepping the CAPTCHA wall. This only
 * fills in the fields SerpApi's product endpoint actually returns (title,
 * description, bullets, category breadcrumbs, price/rating, ISBN/publisher
 * details) — comp-title/ASIN crawling still depends on the direct scrape
 * working, since that data isn't reliably present in SerpApi's response.
 */
export async function scrapeProductPage(
  asin: string,
  marketplace: Marketplace
): Promise<ProductPageData> {
  const direct = await scrapeProductPageDirect(asin, marketplace);

  if ((direct.blocked || !direct.title) && isSerpApiConfigured()) {
    const serpResult = await fetchAmazonProductViaSerpApi(asin, marketplace);
    if (serpResult) {
      const merged: ProductPageData = { ...direct };
      for (const [key, value] of Object.entries(serpResult)) {
        if (value === undefined || value === null) continue;
        const current = (merged as unknown as Record<string, unknown>)[key];
        const isEmpty = current === undefined || current === null || current === "" || (Array.isArray(current) && current.length === 0);
        if (isEmpty) {
          (merged as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return merged;
    }
  }

  return direct;
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
    return { categories: [], competitors: [], productTargetAsins: [], reviewSnippets: [] };
  }

  const firstHopPages = await mapWithConcurrency(firstHopAsins, firstHopAsins.length, (asin) =>
    scrapeProductPage(asin, marketplace)
  );

  const categories = new Set<string>();
  const competitors = new Map<string, RelatedCompetitor>();
  const secondHopCandidates = new Set<string>();
  // Pooling review text across every crawled comp title, not just the seed
  // book — a phrase that recurs across several bestselling comps' reviews is
  // a much stronger signal than one repeating within a single (often
  // review-sparse) book's own reviews. See lib/reviewMining.ts.
  const reviewSnippets: string[] = [];

  firstHopAsins.forEach((asin, i) => {
    const page = firstHopPages[i];
    for (const category of page.categories) categories.add(category);
    if (page.title || page.author) {
      competitors.set(asin, {
        asin,
        author: page.author,
        title: page.title,
        rating: page.rating,
        reviewCount: page.reviewCount,
        bestSellerRank: page.bestSellerRanks?.[0]?.rank,
      });
    }
    reviewSnippets.push(...page.reviewSnippets);
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
      if (page.title || page.author) {
        competitors.set(asin, {
          asin,
          author: page.author,
          title: page.title,
          rating: page.rating,
          reviewCount: page.reviewCount,
          bestSellerRank: page.bestSellerRanks?.[0]?.rank,
        });
      }
      reviewSnippets.push(...page.reviewSnippets);
    });
  }

  return {
    categories: Array.from(categories),
    competitors: Array.from(competitors.values()),
    productTargetAsins: [...firstHopAsins, ...secondHopAsins],
    reviewSnippets,
  };
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
    const page = await fetchPageHtml(url, {
      proxyCountry: SCRAPER_PROXY_COUNTRY[marketplace],
      label: `customer Q&A ${asin}`,
    });
    if (!page.html) return [];

    const $ = cheerio.load(page.html);

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
    const page = await fetchPageHtml(url, {
      proxyCountry: SCRAPER_PROXY_COUNTRY[marketplace],
      label: `customer reviews ${asin}`,
    });
    if (!page.html) return [];

    const $ = cheerio.load(page.html);

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
    const page = await fetchPageHtml(authorUrl, { label: "author catalog" });
    if (!page.html) return [];

    const $ = cheerio.load(page.html);

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
