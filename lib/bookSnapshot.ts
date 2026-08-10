/**
 * The book snapshot: everything the app scrapes about an ASIN, captured
 * *once* when the book is added and persisted to `books.metadata_json`.
 *
 * Why this exists. There used to be two different Amazon scrapers — a thin
 * one behind the "Autofill" button (lib/amazonLookup.ts, no proxy, no
 * bot-check detection) that decided what got saved on the book, and the real
 * one (lib/scrape.ts) that keyword generation re-ran from scratch every time.
 * The thin one is the reason books landed in the library as "Unknown Title",
 * and the re-run is the reason generation was slow and came back thin: it
 * fired ~30 outbound requests at Amazon inside one serverless invocation,
 * most of which get CAPTCHA'd from a datacenter IP.
 *
 * Now there is one scrape, at creation time, through the good scraper, and
 * the keyword generator reads the stored result. Generation only makes the
 * cheap calls that aren't blocked (autocomplete endpoints, Datamuse) and is
 * fast, repeatable and consistent with what the book page displays.
 */

import { enrichBookMetadata, lookupLocSubjects, lookupWikidataGenres, lookupWikipediaCategories } from "./bookMetadata";
import {
  extractAmazonMetadata,
  isFirecrawlConfigured,
  scrapeMarkdown,
  type AmazonPageMetadata,
} from "./firecrawl";
import { deriveGenreTerms, detectGenreFamilies, type GenreFamily } from "./genre";
import { getGoodreadsTags } from "./goodreads";
import { fallbackFormats } from "./listingMetadata";
import { logFieldCoverage, normalizeListingText, validateListingRecord, type ListingRecord } from "./listingRecord";
import { crawlAmazonViaSerpApi, isSerpApiConfigured } from "./serpApi";
import {
  buildSeedsFromMetadata,
  getProductPageUrl,
  scrapeAuthorCatalog,
  scrapeCustomerQnA,
  scrapeCustomerReviews,
  scrapeProductPage,
  scrapeRelatedCompetitors,
} from "./scrape";
import type { Marketplace, ProductPageData, RelatedCompetitor } from "./types";

/**
 * Bumped whenever the captured shape changes in a way that makes older
 * snapshots less useful. Books carrying an older version are re-captured
 * lazily the next time keywords are generated.
 */
export const SNAPSHOT_VERSION = 4;

export interface BookSnapshot {
  version: number;
  capturedAt: string;
  asin: string;
  marketplace: Marketplace;

  /** Resolved identity — what the book row's title/author/description are set from. */
  title?: string;
  author?: string;
  description?: string;
  isbn10?: string;
  isbn13?: string;
  seriesName?: string;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  coverImageUrl?: string;
  categoryPath: string[];
  categories: string[];
  bestSellerRanks: Array<{ rank: number; category: string }>;
  bulletPoints: string[];

  /**
   * Listing-level HTML metadata (lib/listingMetadata.ts): Amazon's own
   * associated terms, the page title, the canonical URL slug and the
   * variation swatches — all keyword sources in their own right.
   */
  htmlTitle?: string;
  metaKeywords: string[];
  metaDescription?: string;
  urlSlug?: string;
  brand?: string;
  variations: string[];

  /**
   * Which editions exist, read from the format swatch strip. The keyword
   * pipeline will not generate or activate a format keyword for a format
   * that isn't here (lib/keywordFilters.ts#formatAvailabilityFilter).
   */
  formats: string[];
  isKindleUnlimited: boolean;

  /** Genre vocabulary + families resolved from every taxonomy source (see lib/genre.ts). */
  genreTerms: string[];
  genreFamilies: GenreFamily[];

  /** Raw-ish scrape products the keyword pipeline mines. */
  compTitles: string[];
  compAsins: string[];
  competitors: RelatedCompetitor[];
  frequentlyBoughtTogether: Array<{ asin: string; title: string }>;
  compareWithSimilar: Array<{ asin: string; title: string }>;
  authorCatalogTitles: string[];
  reviewSnippets: string[];
  reviewBodies: string[];
  compReviewSnippets: string[];
  qnaQuestions: string[];

  /** External metadata sources. */
  googleBooksCategories: string[];
  openLibrarySubjects: string[];
  commonTerms: string[];
  goodreadsTags: string[];
  wikipediaCategories: string[];
  wikidataGenres: string[];
  locSubjects: string[];
  firecrawlMetadata: { categories?: string[]; keywords?: string[]; features?: string[] };
  firecrawlSeeds: string[];
  /** Page text kept for the AI relevance pass, trimmed to keep the row small. */
  pageMarkdownExcerpt?: string;

  /** How the capture went — surfaced in the UI so a blocked scrape isn't silent. */
  capture: {
    ok: boolean;
    blocked: boolean;
    fetchStatus?: number;
    /** Which fetch paths actually produced the book's identity. */
    providers: Array<"amazon-page" | "firecrawl">;
    /** Sources that returned nothing, for the "what did we actually get?" panel. */
    emptySources: string[];
    durationMs: number;
    /** ListingRecord validation: which tracked fields the capture found, and what failed. */
    fieldCoverage?: Record<string, boolean>;
    completeness?: number;
    validationErrors?: string[];
  };
}

/** Legacy books were saved with an ad-hoc metadata blob; treat those as "no snapshot". */
export function isUsableSnapshot(value: unknown): value is BookSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<BookSnapshot>;
  return typeof snapshot.version === "number" && snapshot.version >= SNAPSHOT_VERSION && !!snapshot.asin;
}

/**
 * Resolves to `fallback` instead of hanging the whole capture when one
 * best-effort source is slow. Each underlying fetch has its own timeout, but
 * the comp crawl chains several of them, so the outer bound matters.
 */
async function withBudget<T>(promise: Promise<T>, ms: number, fallback: T, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[captureBookSnapshot] ${label} exceeded ${ms}ms budget — continuing without it`);
          resolve(fallback);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function dedupe(values: (string | undefined)[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= limit) break;
  }
  return out;
}

// Budgets are sized so the two sequential phases (page read, then everything
// that depends on it) fit inside the route's 60s ceiling with headroom:
// ~25s for the slowest reader, then ~18s for the slowest dependent source.
const COMP_CRAWL_BUDGET_MS = 18000;
const SOURCE_BUDGET_MS = 12000;
// Firecrawl renders the page before extracting, so it's the slowest single
// source — but it runs alongside the direct scrape, not after it.
const FIRECRAWL_BUDGET_MS = 25000;
// Enough page text for the AI relevance pass without bloating the book row.
const MAX_MARKDOWN_CHARS = 8000;

/**
 * One ASIN in, one complete snapshot out. Never throws for a source that
 * fails — a blocked or partial scrape still produces a usable book, flagged
 * via `capture` so the UI can offer a re-fetch.
 */
export async function captureBookSnapshot(
  asin: string,
  marketplace: Marketplace
): Promise<BookSnapshot> {
  const startedAt = Date.now();
  const productUrl = getProductPageUrl(asin, marketplace);

  // Two independent reads of the same page, run together:
  //  - the direct/proxied scrape, which gets the structured bits (comp ASINs,
  //    author URL) but is what Amazon CAPTCHAs from datacenter IPs;
  //  - Firecrawl's rendered extraction, which fetches from its own
  //    infrastructure and so keeps working when the direct one is blocked.
  // Whichever succeeds fills the snapshot; when both do, the direct scrape's
  // precise fields win and Firecrawl fills the gaps.
  const [productPage, firecrawl, pageMarkdown]: [
    ProductPageData,
    AmazonPageMetadata,
    string | undefined,
  ] = await Promise.all([
    scrapeProductPage(asin, marketplace),
    isFirecrawlConfigured()
      ? withBudget(extractAmazonMetadata(productUrl), FIRECRAWL_BUDGET_MS, {}, "firecrawl extraction")
      : Promise.resolve({} as AmazonPageMetadata),
    isFirecrawlConfigured()
      ? withBudget(scrapeMarkdown(productUrl), FIRECRAWL_BUDGET_MS, undefined, "firecrawl markdown")
      : Promise.resolve(undefined),
  ]);

  // The identity fields every downstream lookup needs, resolved across both
  // readers before the dependent sources run.
  const resolvedTitle = productPage.title || firecrawl.title;
  const resolvedAuthor = productPage.author || firecrawl.author;
  const resolvedIsbn10 = productPage.isbn10 || firecrawl.isbn10;
  const resolvedIsbn13 = productPage.isbn13 || firecrawl.isbn13;

  const [
    externalMetadata,
    competitorCrawl,
    qnaQuestions,
    reviewBodies,
    authorCatalogTitles,
    wikipediaCategories,
    wikidataGenres,
    locSubjects,
    goodreadsTags,
  ] = await Promise.all([
    withBudget(
      enrichBookMetadata({
        isbn10: resolvedIsbn10,
        isbn13: resolvedIsbn13,
        title: resolvedTitle,
        author: resolvedAuthor,
      }),
      SOURCE_BUDGET_MS,
      { categories: [], subjects: [], commonTerms: [] },
      "google-books/open-library"
    ),
    withBudget(
      scrapeRelatedCompetitors(asin, productPage.compAsins, marketplace),
      COMP_CRAWL_BUDGET_MS,
      { categories: [], competitors: [], productTargetAsins: [], reviewSnippets: [] },
      "competitor crawl"
    ),
    withBudget(scrapeCustomerQnA(asin, marketplace), SOURCE_BUDGET_MS, [] as string[], "customer Q&A"),
    withBudget(scrapeCustomerReviews(asin, marketplace), SOURCE_BUDGET_MS, [] as string[], "customer reviews"),
    productPage.authorUrl
      ? withBudget(scrapeAuthorCatalog(productPage.authorUrl, asin), SOURCE_BUDGET_MS, [] as string[], "author catalog")
      : Promise.resolve([] as string[]),
    withBudget(lookupWikipediaCategories(resolvedTitle), SOURCE_BUDGET_MS, [] as string[], "wikipedia"),
    withBudget(lookupWikidataGenres(resolvedTitle), SOURCE_BUDGET_MS, [] as string[], "wikidata"),
    withBudget(lookupLocSubjects(resolvedTitle), SOURCE_BUDGET_MS, [] as string[], "loc subjects"),
    withBudget(
      getGoodreadsTags(resolvedIsbn10, resolvedTitle, resolvedAuthor),
      SOURCE_BUDGET_MS,
      [] as string[],
      "goodreads"
    ),
  ]);

  const title = resolvedTitle || externalMetadata.title;
  const author = resolvedAuthor || externalMetadata.author;
  const description = productPage.description || firecrawl.description || externalMetadata.description;

  // Firecrawl reports ranks as a loose {rank, category} list; keep only the
  // entries that carry both, then merge behind the scraped ones.
  const firecrawlRanks = (firecrawl.bestSellerRanks ?? []).filter(
    (entry): entry is { rank: number; category: string } =>
      typeof entry?.rank === "number" && typeof entry?.category === "string"
  );
  const bestSellerRanks = productPage.bestSellerRanks.length > 0 ? productPage.bestSellerRanks : firecrawlRanks;
  const bestSellerCategories = bestSellerRanks.map((r) => r.category);

  // Comparable titles: Amazon's carousels via the direct scrape, plus whatever
  // Firecrawl read off the rendered page (which is often all there is when the
  // direct scrape was bot-checked).
  const firecrawlComps = (firecrawl.comparableBooks ?? []).filter((book) => !!book?.title);
  const compTitles = dedupe(
    [...productPage.compTitles, ...firecrawlComps.map((book) => book.title)],
    25
  );

  const competitors: RelatedCompetitor[] = [...competitorCrawl.competitors];
  const knownCompetitorTitles = new Set(
    competitors.map((c) => c.title?.toLowerCase()).filter((title): title is string => !!title)
  );
  for (const book of firecrawlComps) {
    const key = book.title!.toLowerCase();
    if (knownCompetitorTitles.has(key)) continue;
    knownCompetitorTitles.add(key);
    competitors.push({
      // Firecrawl reads titles and authors off the page, not ASINs — the ASIN
      // is only needed for product targeting, which these don't feed.
      asin: "",
      title: book.title,
      author: book.author,
    });
  }

  // When the direct crawl found no comparable titles — the usual outcome of
  // a bot-checked page — SerpApi's snowball crawl reads the same carousels
  // from its own infrastructure. Credit-budgeted, and skipped entirely when
  // the direct crawl already worked or no key is configured.
  if (competitors.length === 0 && isSerpApiConfigured() && title) {
    // Seeded with the deepest (most specific) category node rather than the
    // title: searching a title returns the book itself, searching its
    // subgenre returns the shelf it competes on.
    const categorySeeds = [...productPage.categoryPath, ...(firecrawl.categories ?? [])].slice(-2).reverse();
    const seeds = [...categorySeeds, title].filter((seed): seed is string => !!seed);
    const crawl = await withBudget(
      crawlAmazonViaSerpApi(seeds, marketplace, { maxHops: 1, creditBudget: 6 }),
      COMP_CRAWL_BUDGET_MS,
      { phrases: [], asins: [], competitors: [], creditsUsed: 0 },
      "serpapi comp crawl"
    );
    for (const competitor of crawl.competitors) {
      const key = competitor.title?.toLowerCase();
      if (!key || knownCompetitorTitles.has(key)) continue;
      knownCompetitorTitles.add(key);
      competitors.push(competitor);
    }
    if (crawl.creditsUsed > 0) {
      console.warn(`[captureBookSnapshot] SerpApi comp crawl used ${crawl.creditsUsed} credits for ${asin}`);
    }
  }

  const reviewSnippets = dedupe([...productPage.reviewSnippets, ...(firecrawl.reviewSnippets ?? [])], 60);
  const qna = dedupe([...qnaQuestions, ...(firecrawl.customerQuestions ?? [])], 30);
  const categoryPath = productPage.categoryPath.length > 0 ? productPage.categoryPath : firecrawl.categories ?? [];
  const bulletPoints = productPage.bulletPoints.length > 0 ? productPage.bulletPoints : firecrawl.features ?? [];

  const genreInput = {
    categoryPath,
    // Deliberately not the competitor crawl's categories: comps are related
    // books, not this book, and a single cross-genre also-bought is enough to
    // drag the whole keyword set into the wrong genre.
    categories: [...productPage.categories, ...(firecrawl.categories ?? [])],
    bestSellerCategories,
    googleBooksCategories: externalMetadata.categories,
    openLibrarySubjects: externalMetadata.subjects,
    goodreadsTags,
    wikidataGenres,
    wikipediaCategories,
    title,
    description,
    bulletPoints,
  };

  // Formats decide whether format keywords are allowed to exist at all, so
  // they come from the swatch strip (or the edition rows), never from a
  // page-wide text match — see lib/listingMetadata.ts.
  const formats =
    productPage.availableFormats && productPage.availableFormats.length > 0
      ? productPage.availableFormats
      : fallbackFormats({ bindingType: productPage.bindingType, format: productPage.format });

  const listingRecord: ListingRecord = {
    asin,
    marketplace,
    scrapedAt: new Date().toISOString(),
    sourceUrl: productUrl,
    isCompetitor: false,
    title: normalizeListingText(title),
    bullets: dedupe(bulletPoints, 10),
    description: normalizeListingText(description),
    brand: productPage.brand ?? productPage.publisher ?? firecrawl.publisher,
    categoryPath: dedupe(categoryPath, 12),
    variations: productPage.variations ?? [],
    htmlTitle: normalizeListingText(productPage.htmlTitle),
    metaKeywords: productPage.metaKeywords ?? [],
    metaDescription: normalizeListingText(productPage.metaDescription),
    urlSlug: productPage.urlSlug,
    structuredData: productPage.structuredData ?? [],
    bsr: bestSellerRanks,
    relatedAsins: dedupe([...productPage.compAsins, ...competitorCrawl.productTargetAsins], 30),
    reviewSnippets,
    qaSnippets: qna,
    reviewCount: productPage.reviewCount ?? firecrawl.reviewCount,
    rating: productPage.rating ?? firecrawl.rating,
    price: productPage.price ?? firecrawl.price,
    formats,
    isKindleUnlimited: !!productPage.isKindleUnlimited,
    language: productPage.language || firecrawl.language,
  };

  // Per-field extraction success: a field that stops being found is selector
  // drift, and without this it just looks like a thinner keyword list.
  const validation = validateListingRecord(listingRecord);
  logFieldCoverage(listingRecord, validation);

  const providers: Array<"amazon-page" | "firecrawl"> = [];
  if (productPage.title) providers.push("amazon-page");
  if (firecrawl.title) providers.push("firecrawl");

  const emptySources: string[] = [];
  const track = (label: string, value: { length: number } | undefined) => {
    if (!value || value.length === 0) emptySources.push(label);
  };
  track("product page", title ? [title] : []);
  track("competitors", competitors);
  track("reviews", [...reviewSnippets, ...reviewBodies]);
  track("customer Q&A", qna);
  track("author catalog", authorCatalogTitles);
  track("google books", externalMetadata.categories);
  track("open library", externalMetadata.subjects);
  track("goodreads", goodreadsTags);

  return {
    version: SNAPSHOT_VERSION,
    capturedAt: new Date().toISOString(),
    asin,
    marketplace,

    title,
    author,
    description,
    isbn10: resolvedIsbn10 || externalMetadata.isbn10,
    isbn13: resolvedIsbn13 || externalMetadata.isbn13,
    seriesName: productPage.seriesName || firecrawl.series,
    publisher: productPage.publisher || firecrawl.publisher || externalMetadata.publisher,
    publicationDate:
      productPage.publicationDate || firecrawl.publicationDate || externalMetadata.publicationDate,
    pageCount: productPage.pageCount ?? firecrawl.pageCount ?? externalMetadata.pageCount,
    language: productPage.language || firecrawl.language,
    price: productPage.price ?? firecrawl.price,
    rating: productPage.rating ?? firecrawl.rating,
    reviewCount: productPage.reviewCount ?? firecrawl.reviewCount,
    coverImageUrl: productPage.coverImageUrl || firecrawl.coverImageUrl,
    categoryPath: dedupe(categoryPath, 12),
    categories: dedupe([...productPage.categories, ...(firecrawl.categories ?? [])], 25),
    bestSellerRanks: bestSellerRanks.slice(0, 10),
    bulletPoints: dedupe(bulletPoints, 10),

    htmlTitle: listingRecord.htmlTitle,
    metaKeywords: listingRecord.metaKeywords,
    metaDescription: listingRecord.metaDescription,
    urlSlug: listingRecord.urlSlug,
    brand: listingRecord.brand,
    variations: listingRecord.variations,
    formats,
    isKindleUnlimited: listingRecord.isKindleUnlimited,

    genreTerms: deriveGenreTerms(genreInput),
    genreFamilies: detectGenreFamilies(genreInput),

    compTitles,
    compAsins: dedupe(productPage.compAsins, 10),
    competitors: competitors.slice(0, 40),
    frequentlyBoughtTogether: (productPage.frequentlyBoughtTogether ?? []).slice(0, 10),
    compareWithSimilar: (productPage.compareWithSimilar ?? []).slice(0, 10),
    authorCatalogTitles: dedupe(authorCatalogTitles, 30),
    reviewSnippets,
    reviewBodies: dedupe(reviewBodies, 40),
    compReviewSnippets: dedupe(competitorCrawl.reviewSnippets, 80),
    qnaQuestions: qna,

    googleBooksCategories: dedupe(externalMetadata.categories, 15),
    openLibrarySubjects: dedupe(externalMetadata.subjects, 40),
    commonTerms: dedupe(externalMetadata.commonTerms, 40),
    goodreadsTags: dedupe(goodreadsTags, 30),
    wikipediaCategories: dedupe(wikipediaCategories, 30),
    wikidataGenres: dedupe(wikidataGenres, 15),
    locSubjects: dedupe(locSubjects, 20),
    firecrawlMetadata: {
      categories: firecrawl.categories,
      keywords: firecrawl.keywords,
      features: firecrawl.features,
    },
    firecrawlSeeds: dedupe(buildSeedsFromMetadata(firecrawl), 20),
    pageMarkdownExcerpt: pageMarkdown?.slice(0, MAX_MARKDOWN_CHARS),

    capture: {
      // A title from either reader means there's a book to work with, even if
      // the direct scrape was bot-checked.
      ok: !!title,
      blocked: !!productPage.blocked && !firecrawl.title,
      fetchStatus: productPage.fetchStatus,
      providers,
      emptySources,
      durationMs: Date.now() - startedAt,
      fieldCoverage: validation.coverage,
      completeness: validation.completeness,
      validationErrors: validation.errors,
    },
  };
}

/**
 * The stored snapshot as a `ListingRecord` — the validated, flat shape the
 * keyword miner and the bulksheet export both work from. Rebuilt from the
 * snapshot rather than stored twice, so there is one source of truth per
 * book and older snapshots (captured before a field existed) still produce a
 * valid record with that field empty.
 */
export function listingRecordFromSnapshot(snapshot: BookSnapshot, sourceUrl?: string): ListingRecord {
  return {
    asin: snapshot.asin,
    marketplace: snapshot.marketplace,
    scrapedAt: snapshot.capturedAt,
    sourceUrl: sourceUrl ?? getProductPageUrl(snapshot.asin, snapshot.marketplace),
    isCompetitor: false,
    title: snapshot.title,
    bullets: snapshot.bulletPoints,
    description: snapshot.description,
    brand: snapshot.brand ?? snapshot.publisher,
    categoryPath: snapshot.categoryPath,
    variations: snapshot.variations ?? [],
    htmlTitle: snapshot.htmlTitle,
    metaKeywords: snapshot.metaKeywords ?? [],
    metaDescription: snapshot.metaDescription,
    urlSlug: snapshot.urlSlug,
    structuredData: [],
    bsr: snapshot.bestSellerRanks,
    relatedAsins: snapshot.compAsins,
    reviewSnippets: snapshot.reviewSnippets,
    qaSnippets: snapshot.qnaQuestions,
    reviewCount: snapshot.reviewCount,
    rating: snapshot.rating,
    price: snapshot.price,
    formats: snapshot.formats ?? [],
    isKindleUnlimited: !!snapshot.isKindleUnlimited,
    language: snapshot.language,
  };
}

/** One-line explanation of a capture, for API responses and the book page. */
export function describeCapture(snapshot: BookSnapshot): string | undefined {
  const firecrawlHint = isFirecrawlConfigured()
    ? " Re-fetch to try again."
    : " Setting FIRECRAWL_API_KEY lets the app read the page through Firecrawl instead, which isn't blocked this way.";

  if (snapshot.capture.blocked) {
    return `Amazon served a bot check instead of the product page, so only partial metadata was captured.${firecrawlHint}`;
  }
  if (!snapshot.capture.ok) {
    return `The Amazon product page could not be read, so this book has only partial metadata.${firecrawlHint}`;
  }
  if (snapshot.capture.emptySources.length > 0) {
    return `Captured, but these sources returned nothing: ${snapshot.capture.emptySources.join(", ")}.`;
  }
  return undefined;
}
