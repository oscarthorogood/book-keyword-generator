import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { BookMetadata } from "./types";

const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

interface GoogleBooksVolume {
  id?: string;
  volumeInfo?: {
    description?: string;
    categories?: string[];
  };
}

/**
 * Google Books API — free, works without a key (Google recommends one to
 * avoid throttling under heavy use, but a single-user tool like this is
 * fine without). Looks up by ISBN first, falls back to title+author search.
 * Also returns the matched volume's ID so callers can look up the same book
 * on the books.google.com web frontend (see scrapeGoogleBooksCommonTerms).
 */
export async function lookupGoogleBooks(
  isbn: string | undefined,
  title: string | undefined,
  author: string | undefined
): Promise<{ description?: string; categories: string[]; volumeId?: string }> {
  const apiKey = process.env.GOOGLE_BOOKS_API_KEY;
  const query = isbn ? `isbn:${isbn}` : title ? `intitle:${title}${author ? `+inauthor:${author}` : ""}` : null;
  if (!query) return { categories: [] };

  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}${
    apiKey ? `&key=${apiKey}` : ""
  }`;

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return { categories: [] };
    const json = (await res.json()) as { items?: GoogleBooksVolume[] };
    const item = json.items?.[0];
    return {
      description: item?.volumeInfo?.description,
      categories: item?.volumeInfo?.categories ?? [],
      volumeId: item?.id,
    };
  } catch {
    return { categories: [] };
  }
}

/**
 * Google Books' "About this book" web page sometimes shows a "Common terms
 * and phrases" word list that Google auto-extracts from the book's actual
 * text (only available for titles Google has preview/snippet access to). It's
 * a free, content-derived signal the official API above doesn't expose.
 *
 * This scrapes the web frontend rather than the API, which is shakier ToS
 * territory than the API call above and Google can restructure or block the
 * page without notice — for a low-volume single-user lookup tool this is the
 * same risk class as the Amazon page/autocomplete scrapes elsewhere in this
 * app, but it hasn't been verified against a live page (this environment
 * can't reach books.google.com to check), so confirm it actually finds
 * anything once deployed. Treat a miss as "no extra terms," never a hard
 * failure — the section may simply not exist for a given book.
 */
export async function scrapeGoogleBooksCommonTerms(volumeId: string | undefined): Promise<string[]> {
  if (!volumeId) return [];

  const url = `https://books.google.com/books?id=${encodeURIComponent(volumeId)}`;

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return [];

    const html = await res.text();
    const $ = cheerio.load(html);

    // .last() rather than .first(): when the heading's own wrapper element
    // has no other content, its trimmed text also equals the heading string,
    // so the outer wrapper matches too — .last() picks the innermost (most
    // specific) match instead of that ancestor.
    const heading = $("*")
      .filter((_, el) => $(el).text().trim().toLowerCase() === "common terms and phrases")
      .last();
    if (heading.length === 0) return [];

    // The exact DOM shape around this heading isn't verified against a live
    // page (see note above), so try a few plausible layouts rather than
    // betting on one: terms as unwrapped siblings, terms inside a wrapping
    // sibling container, or terms as siblings within the heading's parent.
    const terms = new Set<string>();
    const collect = <T extends AnyNode>(anchors: cheerio.Cheerio<T>) => {
      anchors.each((_, a) => {
        const text = $(a).text().trim().toLowerCase();
        if (text) terms.add(text);
      });
    };

    collect(heading.nextAll("a"));
    if (terms.size === 0 && heading.next().length) collect(heading.next().find("a"));
    if (terms.size === 0) collect(heading.parent().find("a"));

    return Array.from(terms)
      .filter((t) => t.length > 1 && t.length < 40)
      .slice(0, 40);
  } catch {
    return [];
  }
}

interface OpenLibraryBookEntry {
  subjects?: { name: string }[];
}

/**
 * Open Library API — free, no key required. Asked to use a descriptive
 * User-Agent and cache results since they're a non-profit; we don't cache
 * (stateless v1) but do set a clear UA and keep this call best-effort.
 */
export async function lookupOpenLibrary(
  isbn: string | undefined,
  title: string | undefined,
  author: string | undefined
): Promise<{ subjects: string[] }> {
  const userAgent = "amazon-ads-assistant/0.1 (single-user internal tool)";

  try {
    if (isbn) {
      const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(
        isbn
      )}&format=json&jscmd=data`;
      const res = await fetchWithTimeout(url, { headers: { "User-Agent": userAgent } });
      if (res.ok) {
        const json = (await res.json()) as Record<string, OpenLibraryBookEntry>;
        const entry = json[`ISBN:${isbn}`];
        const subjects = entry?.subjects?.map((s) => s.name) ?? [];
        if (subjects.length > 0) return { subjects };
      }
    }

    if (title) {
      const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(
        title
      )}${author ? `&author=${encodeURIComponent(author)}` : ""}&limit=1&fields=subject`;
      const res = await fetchWithTimeout(searchUrl, { headers: { "User-Agent": userAgent } });
      if (res.ok) {
        const json = (await res.json()) as { docs?: { subject?: string[] }[] };
        const subjects = json.docs?.[0]?.subject ?? [];
        return { subjects };
      }
    }

    return { subjects: [] };
  } catch {
    return { subjects: [] };
  }
}

export async function enrichBookMetadata(params: {
  isbn10?: string;
  isbn13?: string;
  title?: string;
  author?: string;
}): Promise<BookMetadata> {
  const isbn = params.isbn13 ?? params.isbn10;

  const openLibraryPromise = lookupOpenLibrary(isbn, params.title, params.author);
  const googleBooks = await lookupGoogleBooks(isbn, params.title, params.author);
  const [openLibrary, commonTerms] = await Promise.all([
    openLibraryPromise,
    scrapeGoogleBooksCommonTerms(googleBooks.volumeId),
  ]);

  return {
    title: params.title,
    author: params.author,
    isbn10: params.isbn10,
    isbn13: params.isbn13,
    description: googleBooks.description,
    categories: googleBooks.categories,
    subjects: openLibrary.subjects,
    commonTerms,
  };
}
