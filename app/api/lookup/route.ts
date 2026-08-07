import { NextRequest, NextResponse } from "next/server";
import { enrichBookMetadata, lookupWikipediaCategories, lookupWikidataGenres, lookupLocSubjects } from "@/lib/bookMetadata";
import { extractAmazonMetadata, isFirecrawlConfigured, type AmazonPageMetadata } from "@/lib/firecrawl";
import { getGoodreadsTags } from "@/lib/goodreads";
import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { getProductPageUrl, scrapeProductPage } from "@/lib/scrape";
import { Marketplace } from "@/lib/types";
import { currentUserEmail } from "@/lib/supabaseServer";

export const runtime = "nodejs";
// Longer than the plain page scrape alone (20s) to give the parallel Google
// Books / Open Library / Goodreads lookups room — Goodreads in particular
// can chain two sequential fetches (search + book page) when there's no
// direct ISBN match.
export const maxDuration = 45;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];

/**
 * Builds a full "book profile" from the ASIN/ISBN alone — used by the
 * Autofill button on the Generate/Harvest forms. Beyond title/author/series/
 * price, this now also surfaces genre/subgenre (Amazon's own category
 * breadcrumb), Best Sellers Rank standings, the publisher's description +
 * bullets, and a combined, deduped tag list pulled from every free source
 * this app already knows how to query (Amazon categories, Google Books,
 * Open Library, Goodreads shelves) — the idea being to front-load as much
 * signal as possible into one reviewable step, which the user can then prune
 * before it feeds the full keyword-generation pipeline (see knownTags on
 * GenerateRequest and buildKnownTagCandidates in lib/keywordMerge.ts).
 */
export async function GET(req: NextRequest) {
  // The Next 16 docs warn that a proxy matcher change can silently drop
  // coverage, so authorize here too rather than trusting proxy.ts alone.
  if (!(await currentUserEmail())) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const rawAsin = req.nextUrl.searchParams.get("asin") ?? "";
  const asin = normalizeAsinOrIsbn(rawAsin);
  const marketplace = req.nextUrl.searchParams.get("marketplace") as Marketplace | null;

  if (!asin) {
    return NextResponse.json({ error: "Enter a valid ASIN, ISBN-10, or ISBN-13." }, { status: 400 });
  }
  if (!marketplace || !MARKETPLACES.includes(marketplace)) {
    return NextResponse.json(
      { error: `Marketplace must be one of ${MARKETPLACES.join(", ")}.` },
      { status: 400 }
    );
  }

  const productPage = await scrapeProductPage(asin, marketplace);
  if (!productPage.title) {
    const statusNote =
      productPage.fetchStatus !== undefined
        ? ` (upstream HTTP ${productPage.fetchStatus})`
        : " (no response — network error or timeout)";
    const error = productPage.blocked
      ? `Amazon blocked this request (bot/CAPTCHA check)${statusNote} instead of serving the real page — common when scraping from a cloud-hosted deployment (Vercel, etc.), much rarer from a home IP. Fill in the fields manually for now; see the README's 'Known open items' for mitigation options.`
      : `Couldn't load or parse that product page${statusNote}. Double check the ASIN and marketplace, or fill in the fields manually.`;
    return NextResponse.json(
      { error, blocked: productPage.blocked ?? false, fetchStatus: productPage.fetchStatus },
      { status: 502 }
    );
  }

  const [bookMetadata, goodreadsTags, firecrawlMetadata, wikipediaCategories, wikidataGenres, locSubjects] = await Promise.all([
    enrichBookMetadata({
      isbn10: productPage.isbn10,
      isbn13: productPage.isbn13,
      title: productPage.title,
      author: productPage.author,
    }),
    getGoodreadsTags(productPage.isbn10, productPage.title, productPage.author),
    isFirecrawlConfigured() ? extractAmazonMetadata(getProductPageUrl(asin, marketplace)) : Promise.resolve<AmazonPageMetadata>({}),
    lookupWikipediaCategories(productPage.title),
    lookupWikidataGenres(productPage.title),
    lookupLocSubjects(productPage.title),
  ]);

  const tags = Array.from(
    new Set(
      [...productPage.categoryPath, ...bookMetadata.categories, ...bookMetadata.subjects, ...goodreadsTags]
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );

  return NextResponse.json({
    // Identifiers
    asin,
    title: productPage.title,
    author: productPage.author,
    authorBio: productPage.authorBio,
    authorImage: productPage.authorImage,
    seriesName: productPage.seriesName,

    // Pricing
    price: productPage.price,
    originalPrice: productPage.originalPrice,
    discountPercentage: productPage.discountPercentage,
    primeEligible: productPage.primeEligible,

    // Format info
    format: productPage.format,
    edition: productPage.edition,
    bindingType: productPage.bindingType,
    hasAudiobook: productPage.hasAudiobook,
    hasKindle: productPage.hasKindle,
    hasPhysical: productPage.hasPhysical,

    // Images
    coverImageUrl: productPage.coverImageUrl,

    // Competitive products
    compTitles: productPage.compTitles,
    compDetails: productPage.compDetails,
    frequentlyBoughtTogether: productPage.frequentlyBoughtTogether,
    compareWithSimilar: productPage.compareWithSimilar,

    // Ratings & reviews
    rating: productPage.rating,
    reviewCount: productPage.reviewCount,
    qaCount: productPage.qaCount,
    ratingDistribution: productPage.ratingDistribution,

    // Categories & rankings
    categoryPath: productPage.categoryPath,
    bestSellerRanks: productPage.bestSellerRanks,
    allCategoryRanks: productPage.allCategoryRanks,
    amazonChoiceBadge: productPage.amazonChoiceBadge,
    bestsellerBadge: productPage.bestsellerBadge,

    // Content
    description: productPage.description,
    bulletPoints: productPage.bulletPoints,
    tableOfContents: productPage.tableOfContents,
    wordCount: productPage.wordCount,
    lexileLevel: productPage.lexileLevel,
    ageRange: productPage.ageRange,
    contentWarnings: productPage.contentWarnings,

    // Publication details
    publisher: productPage.publisher,
    publicationDate: productPage.publicationDate,
    copyrightYear: productPage.copyrightYear,
    pageCount: productPage.pageCount,
    language: productPage.language,
    languages: productPage.languages,
    dimensions: productPage.dimensions,

    // Availability
    availability: productPage.availability,
    stockStatus: productPage.stockStatus,
    hasLookInside: productPage.hasLookInside,

    // Awards
    awards: productPage.awards,
    awardNominations: productPage.awardNominations,

    // External metadata
    googleBooksCategories: bookMetadata.categories,
    openLibrarySubjects: bookMetadata.subjects,
    goodreadsTags,
    tags,

    // Firecrawl structured extraction
    firecrawlCategories: firecrawlMetadata.categories ?? [],
    firecrawlFeatures: firecrawlMetadata.features ?? [],
    firecrawlKeywords: firecrawlMetadata.keywords ?? [],

    // Enriched metadata from various sources
    wikipediaCategories,
    wikidataGenres,
    locSubjects,
  });
}
