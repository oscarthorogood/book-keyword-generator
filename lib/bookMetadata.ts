import { BookMetadata } from "./types";

const FETCH_TIMEOUT_MS = 8000;

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
  volumeInfo?: {
    description?: string;
    categories?: string[];
  };
}

/**
 * Google Books API — free, works without a key (Google recommends one to
 * avoid throttling under heavy use, but a single-user tool like this is
 * fine without). Looks up by ISBN first, falls back to title+author search.
 */
export async function lookupGoogleBooks(
  isbn: string | undefined,
  title: string | undefined,
  author: string | undefined
): Promise<{ description?: string; categories: string[] }> {
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
    const info = json.items?.[0]?.volumeInfo;
    return {
      description: info?.description,
      categories: info?.categories ?? [],
    };
  } catch {
    return { categories: [] };
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

  const [googleBooks, openLibrary] = await Promise.all([
    lookupGoogleBooks(isbn, params.title, params.author),
    lookupOpenLibrary(isbn, params.title, params.author),
  ]);

  return {
    title: params.title,
    author: params.author,
    isbn10: params.isbn10,
    isbn13: params.isbn13,
    description: googleBooks.description,
    categories: googleBooks.categories,
    subjects: openLibrary.subjects,
  };
}
