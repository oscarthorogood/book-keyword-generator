import { NextRequest, NextResponse } from "next/server";
import { enrichBookMetadata } from "@/lib/bookMetadata";
import { getGoodreadsTags } from "@/lib/goodreads";
import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { scrapeProductPage } from "@/lib/scrape";
import { Marketplace } from "@/lib/types";

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

  const [bookMetadata, goodreadsTags] = await Promise.all([
    enrichBookMetadata({
      isbn10: productPage.isbn10,
      isbn13: productPage.isbn13,
      title: productPage.title,
      author: productPage.author,
    }),
    getGoodreadsTags(productPage.isbn10, productPage.title, productPage.author),
  ]);

  const tags = Array.from(
    new Set(
      [...productPage.categoryPath, ...bookMetadata.categories, ...bookMetadata.subjects, ...goodreadsTags]
        .map((t) => t.trim())
        .filter(Boolean)
    )
  );

  return NextResponse.json({
    asin,
    title: productPage.title,
    author: productPage.author,
    seriesName: productPage.seriesName,
    price: productPage.price,
    description: productPage.description,
    bulletPoints: productPage.bulletPoints,
    categoryPath: productPage.categoryPath,
    bestSellerRanks: productPage.bestSellerRanks,
    compTitles: productPage.compTitles,
    googleBooksCategories: bookMetadata.categories,
    openLibrarySubjects: bookMetadata.subjects,
    goodreadsTags,
    tags,
  });
}
