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
  title?: string;
  authors?: { name: string }[];
  description?: string | { value: string };
  isbn_10?: string[];
  isbn_13?: string[];
  publishers?: { name: string }[];
  publish_date?: string;
  number_of_pages?: number;
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
): Promise<{
  subjects: string[];
  title?: string;
  author?: string;
  description?: string;
  isbn10?: string;
  isbn13?: string;
  publisherName?: string;
  publishDate?: string;
  pageCount?: number;
}> {
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
        if (entry) {
          return {
            subjects,
            title: entry.title,
            author: entry.authors?.[0]?.name,
            description: entry.description,
            isbn10: entry.isbn_10?.[0],
            isbn13: entry.isbn_13?.[0],
            publisherName: entry.publishers?.[0]?.name,
            publishDate: entry.publish_date,
            pageCount: entry.number_of_pages,
          };
        }
      }
    }

    if (title) {
      const searchUrl = `https://openlibrary.org/search.json?title=${encodeURIComponent(
        title
      )}${author ? `&author=${encodeURIComponent(author)}` : ""}&limit=1&fields=subject,author_name,isbn,publisher,first_publish_year,page_count`;
      const res = await fetchWithTimeout(searchUrl, { headers: { "User-Agent": userAgent } });
      if (res.ok) {
        const json = (await res.json()) as {
          docs?: Array<{
            title?: string;
            author_name?: string[];
            subject?: string[];
            isbn?: string[];
            publisher?: string[];
            first_publish_year?: number;
            page_count?: number;
          }>;
        };
        const doc = json.docs?.[0];
        if (doc) {
          return {
            subjects: doc.subject ?? [],
            title: doc.title,
            author: doc.author_name?.[0],
            isbn10: doc.isbn?.[0],
            publisherName: doc.publisher?.[0],
            pageCount: doc.page_count,
          };
        }
      }
    }

    return { subjects: [] };
  } catch {
    return { subjects: [] };
  }
}

interface WikipediaSearchResult {
  query?: { search?: { title?: string }[] };
}
interface WikipediaCategoriesResult {
  query?: { pages?: Record<string, { categories?: { title?: string }[] }> };
}

// Wikipedia's own maintenance/administrative categories (article-quality
// tags, citation-style tags, etc.) rather than actual subject matter — these
// show up on nearly every article and would otherwise pollute every result.
const WIKIPEDIA_NOISE_CATEGORY = /wikipedia|cs1|articles|pages|stub|dates|use \w+ english|short description|all\s/i;

/**
 * Wikipedia's free, keyless search + categories API. Looks up the closest
 * matching article for the book title, then pulls that article's categories
 * as thematic keyword candidates. Most indie/niche titles won't have a
 * Wikipedia article at all — this is expected to come back empty far more
 * often than the other sources, which is fine, it's zero-cost when it does.
 */
export async function lookupWikipediaCategories(title: string | undefined): Promise<string[]> {
  if (!title) return [];

  try {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch=${encodeURIComponent(
      title
    )}`;
    const searchRes = await fetchWithTimeout(searchUrl);
    if (!searchRes.ok) return [];
    const searchJson = (await searchRes.json()) as WikipediaSearchResult;
    const pageTitle = searchJson.query?.search?.[0]?.title;
    if (!pageTitle) return [];

    const catUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=categories&format=json&cllimit=50&titles=${encodeURIComponent(
      pageTitle
    )}`;
    const catRes = await fetchWithTimeout(catUrl);
    if (!catRes.ok) return [];
    const catJson = (await catRes.json()) as WikipediaCategoriesResult;

    const categories: string[] = [];
    for (const page of Object.values(catJson.query?.pages ?? {})) {
      for (const category of page.categories ?? []) {
        const name = category.title?.replace(/^Category:/, "");
        if (name && !WIKIPEDIA_NOISE_CATEGORY.test(name)) categories.push(name);
      }
    }
    return categories;
  } catch {
    return [];
  }
}

interface WikidataSearchResult {
  search?: { id?: string }[];
}
interface WikidataEntityResult {
  entities?: Record<
    string,
    { claims?: Record<string, { mainsnak?: { datavalue?: { value?: { id?: string } } } }[]> }
  >;
}
interface WikidataLabelsResult {
  entities?: Record<string, { labels?: { en?: { value?: string } } }>;
}

const WIKIDATA_GENRE_PROPERTY = "P136";

/**
 * Wikidata's free, keyless API: searches for an entity matching the book
 * title, reads its "genre" (P136) statements, then resolves those genre
 * entity IDs to human-readable English labels. Three small requests instead
 * of one — Wikidata claims store genre as a QID reference, not text, so a
 * label lookup is required to get anything keyword-usable back.
 */
export async function lookupWikidataGenres(title: string | undefined): Promise<string[]> {
  if (!title) return [];

  try {
    const searchUrl = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=en&type=item&limit=1&search=${encodeURIComponent(
      title
    )}`;
    const searchRes = await fetchWithTimeout(searchUrl);
    if (!searchRes.ok) return [];
    const searchJson = (await searchRes.json()) as WikidataSearchResult;
    const qid = searchJson.search?.[0]?.id;
    if (!qid) return [];

    const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${qid}.json`;
    const entityRes = await fetchWithTimeout(entityUrl);
    if (!entityRes.ok) return [];
    const entityJson = (await entityRes.json()) as WikidataEntityResult;
    const genreClaims = entityJson.entities?.[qid]?.claims?.[WIKIDATA_GENRE_PROPERTY] ?? [];
    const genreQids = genreClaims
      .map((claim) => claim.mainsnak?.datavalue?.value?.id)
      .filter((v): v is string => !!v);
    if (genreQids.length === 0) return [];

    const labelsUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels&languages=en&ids=${genreQids.join(
      "|"
    )}`;
    const labelsRes = await fetchWithTimeout(labelsUrl);
    if (!labelsRes.ok) return [];
    const labelsJson = (await labelsRes.json()) as WikidataLabelsResult;
    return Object.values(labelsJson.entities ?? {})
      .map((entity) => entity.labels?.en?.value)
      .filter((v): v is string => !!v);
  } catch {
    return [];
  }
}

/**
 * Library of Congress Subject Headings — free, keyless OpenSearch-style
 * suggest endpoint (`[query, labels[], descriptions[], urls[]]`, the same
 * response shape as most browser search-box suggest APIs). LCSH terms are a
 * controlled vocabulary curated by librarians, a different (more formal)
 * register than autocomplete or review-text sources.
 */
export async function lookupLocSubjects(term: string | undefined): Promise<string[]> {
  if (!term) return [];

  try {
    const url = `https://id.loc.gov/authorities/subjects/suggest/?q=${encodeURIComponent(term)}`;
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const json = (await res.json()) as [string, string[], string[], string[]];
    return json?.[1] ?? [];
  } catch {
    return [];
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
    title: params.title || openLibrary.title,
    author: params.author || openLibrary.author,
    isbn10: params.isbn10 || openLibrary.isbn10,
    isbn13: params.isbn13 || openLibrary.isbn13,
    description: googleBooks.description || openLibrary.description,
    categories: googleBooks.categories,
    subjects: openLibrary.subjects,
    commonTerms,
    publisher: openLibrary.publisherName,
    publicationDate: openLibrary.publishDate?.toString(),
    pageCount: openLibrary.pageCount,
  };
}
