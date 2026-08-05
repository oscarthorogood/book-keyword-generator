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
    const res = await fetchWithTimeout(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
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
 * Fetches a handful of autocomplete completions across common book-search
 * prefixes ("<title>", "<title> book", "<title> series", ...) so we get more
 * than just what the raw title returns.
 */
export async function getAutocompleteKeywordSet(
  seedTerms: string[],
  marketplace: Marketplace
): Promise<KeywordCandidate[]> {
  const results = await Promise.all(
    seedTerms.map((term) => getAutocompleteSuggestions(term, marketplace))
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

/**
 * Scrapes the book's own Amazon product page for title/author/ISBN plus
 * thematic context: "customers also bought" titles and category/best-seller
 * placement text. Best-effort — returns whatever it can find, empty arrays
 * on total failure.
 */
export async function scrapeProductPage(
  asin: string,
  marketplace: Marketplace
): Promise<ProductPageData> {
  const domain = AMAZON_DOMAINS[marketplace];
  const url = `https://www.${domain}/dp/${encodeURIComponent(asin)}`;
  const empty: ProductPageData = { compTitles: [], categories: [] };

  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) return empty;

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
    $(
      '[data-a-carousel-options*="also-bought"] .p13n-sc-truncate, [id*="similarities"] img[alt], .a-carousel-card img[alt]'
    ).each((_, el) => {
      const alt = $(el).attr("alt")?.trim();
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
      compTitles: Array.from(compTitles).slice(0, 15),
      categories: Array.from(categories).slice(0, 15),
    };
  } catch {
    return empty;
  }
}
