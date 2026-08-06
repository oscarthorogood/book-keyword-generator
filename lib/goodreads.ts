import * as cheerio from "cheerio";
import { PAGE_TIMEOUT_MS, PROXIED_PAGE_TIMEOUT_MS, resolveScraperProxyUrl, SCRAPER_PROXY_API_KEY } from "./scrape";
import { KeywordCandidate } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchGoodreadsHtml(url: string): Promise<string | null> {
  const fetchUrl = resolveScraperProxyUrl(url);
  try {
    const res = await fetchWithTimeout(fetchUrl, SCRAPER_PROXY_API_KEY ? PROXIED_PAGE_TIMEOUT_MS : PAGE_TIMEOUT_MS);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

/**
 * Current Goodreads book-page markup for the "Genres" shelf-tag list —
 * unverified against a live page, like every other DOM-shape guess in this
 * app. Tries a couple of plausible selectors and degrades to an empty list
 * rather than erroring if none match.
 */
function extractShelfTags($: cheerio.CheerioAPI): string[] {
  const tags = new Set<string>();
  $(
    '.BookPageMetadataSection__genreButton, a.actionLinkLite.bookPageGenreLink, [data-testid="genresList"] a'
  ).each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text && text.length < 40) tags.add(text.toLowerCase());
  });
  return Array.from(tags).slice(0, 15);
}

/**
 * Best-effort Goodreads lookup for community-tagged genre/trope shelves
 * ("enemies-to-lovers", "found-family", "cozy-mystery") — arguably the
 * richest free source of exact reader trope vocabulary for fiction, since
 * it's crowd-tagged rather than inferred. Tries the ISBN redirect first
 * (goodreads.com/book/isbn/{isbn10} redirects straight to the book page when
 * there's a match), falling back to a title+author search result.
 *
 * Goodreads is Amazon-owned but runs on separate infrastructure — whether it
 * applies the same datacenter-IP blocking as amazon.com is unconfirmed.
 * Routes through SCRAPER_PROXY_API_KEY when configured, same as the Amazon
 * product-page scrape. Fails soft to an empty list on any failure — never
 * blocks the export.
 */
export async function getGoodreadsTags(
  isbn10: string | undefined,
  title: string | undefined,
  author: string | undefined
): Promise<string[]> {
  if (isbn10) {
    const html = await fetchGoodreadsHtml(`https://www.goodreads.com/book/isbn/${encodeURIComponent(isbn10)}`);
    if (html) {
      const tags = extractShelfTags(cheerio.load(html));
      if (tags.length > 0) return tags;
    }
  }

  const query = [title, author].filter(Boolean).join(" ").trim();
  if (!query) return [];

  const searchHtml = await fetchGoodreadsHtml(`https://www.goodreads.com/search?q=${encodeURIComponent(query)}`);
  if (!searchHtml) return [];

  const firstResultHref = cheerio.load(searchHtml)("a.bookTitle").first().attr("href");
  if (!firstResultHref) return [];

  const bookUrl = firstResultHref.startsWith("http")
    ? firstResultHref
    : `https://www.goodreads.com${firstResultHref}`;
  const bookHtml = await fetchGoodreadsHtml(bookUrl);
  if (!bookHtml) return [];

  return extractShelfTags(cheerio.load(bookHtml));
}

export function buildGoodreadsTagCandidates(tags: string[]): KeywordCandidate[] {
  return tags
    .map((tag) => tag.replace(/-/g, " ").trim())
    .filter((tag) => tag.length >= 3)
    .map((text) => ({ text, sources: ["goodreads-tags" as const] }));
}
