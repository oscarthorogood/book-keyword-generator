import { NextRequest, NextResponse } from "next/server";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { enrichBookMetadata } from "@/lib/bookMetadata";
import { buildBulksheet } from "@/lib/bulksheet";
import {
  buildBookContentCandidates,
  buildBuyerIntentCandidates,
  buildCategoryCandidates,
  buildCompTitleCandidates,
  buildGenreMetadataCandidates,
  finalizeKeywords,
  mergeKeywordCandidates,
} from "@/lib/keywordMerge";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  scrapeProductPage,
  scrapeRelatedCategories,
} from "@/lib/scrape";
import { GenerateRequest, KeywordCandidate, Marketplace, MatchType, SourceStatus } from "@/lib/types";

export const runtime = "nodejs";
// Give the autocomplete sweeps (dozens of small outbound requests) room to
// finish; if your Vercel plan caps function duration lower than this, lower
// AUTOCOMPLETE_CONCURRENCY / MAX_AUTOCOMPLETE_SEEDS in lib/scrape.ts instead.
export const maxDuration = 60;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];
const MATCH_TYPES: MatchType[] = ["broad", "phrase", "exact"];
const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

function validate(body: unknown): { value: GenerateRequest } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Invalid request body." };
  const b = body as Record<string, unknown>;

  if (typeof b.asin !== "string" || !ASIN_PATTERN.test(b.asin.trim())) {
    return { error: "ASIN must be a 10-character alphanumeric code." };
  }
  if (typeof b.marketplace !== "string" || !MARKETPLACES.includes(b.marketplace as Marketplace)) {
    return { error: `Marketplace must be one of ${MARKETPLACES.join(", ")}.` };
  }
  if (typeof b.campaignName !== "string" || !b.campaignName.trim()) {
    return { error: "Campaign Name is required." };
  }
  if (typeof b.adGroupName !== "string" || !b.adGroupName.trim()) {
    return { error: "Ad Group Name is required." };
  }
  if (typeof b.dailyBudget !== "number" || !Number.isFinite(b.dailyBudget) || b.dailyBudget <= 0) {
    return { error: "Daily Budget must be a positive number." };
  }
  if (typeof b.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) {
    return { error: "Start Date must be in YYYY-MM-DD format." };
  }
  if (typeof b.defaultBid !== "number" || !Number.isFinite(b.defaultBid) || b.defaultBid <= 0) {
    return { error: "Default Bid must be a positive number." };
  }
  if (
    !Array.isArray(b.matchTypes) ||
    b.matchTypes.length === 0 ||
    !b.matchTypes.every((m) => MATCH_TYPES.includes(m as MatchType))
  ) {
    return { error: "Select at least one match type (broad, phrase, exact)." };
  }

  return {
    value: {
      asin: b.asin.trim().toUpperCase(),
      marketplace: b.marketplace as Marketplace,
      campaignName: b.campaignName.trim(),
      adGroupName: b.adGroupName.trim(),
      dailyBudget: b.dailyBudget,
      startDate: b.startDate,
      defaultBid: b.defaultBid,
      matchTypes: b.matchTypes as MatchType[],
    },
  };
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const validated = validate(body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const request = validated.value;

  const sourceStatuses: SourceStatus[] = [];

  const productPage = await scrapeProductPage(request.asin, request.marketplace);
  sourceStatuses.push({
    source: "product-page",
    ok: !!productPage.title,
    count: productPage.compTitles.length,
    error: productPage.title ? undefined : "Could not load or parse the product page.",
  });

  const seedTerms = productPage.title
    ? buildAutocompleteSeeds(productPage.title, productPage.author)
    : [request.asin];

  const [adsApiResult, autocompleteResult, googleAutocompleteResult, bookMetadata, relatedCategories] =
    await Promise.all([
      isAdsApiConfigured()
        ? getAdsApiKeywordRecommendations(request.asin, request.marketplace)
            .then((candidates) => ({ candidates, error: undefined as string | undefined }))
            .catch((err: Error) => ({ candidates: [] as KeywordCandidate[], error: err.message }))
        : Promise.resolve({
            candidates: [] as KeywordCandidate[],
            error: "Amazon Ads API credentials not configured.",
          }),
      getAutocompleteKeywordSet(seedTerms, request.marketplace),
      getGoogleAutocompleteKeywordSet(seedTerms),
      enrichBookMetadata({
        isbn10: productPage.isbn10,
        isbn13: productPage.isbn13,
        title: productPage.title,
        author: productPage.author,
      }),
      scrapeRelatedCategories(productPage.compAsins, request.marketplace),
    ]);

  sourceStatuses.push({
    source: "ads-api",
    ok: adsApiResult.candidates.length > 0,
    count: adsApiResult.candidates.length,
    error: adsApiResult.error,
  });
  sourceStatuses.push({
    source: "autocomplete",
    ok: autocompleteResult.length > 0,
    count: autocompleteResult.length,
  });
  sourceStatuses.push({
    source: "google-autocomplete",
    ok: googleAutocompleteResult.length > 0,
    count: googleAutocompleteResult.length,
  });
  sourceStatuses.push({
    source: "google-books",
    ok: bookMetadata.categories.length > 0,
    count: bookMetadata.categories.length,
  });
  sourceStatuses.push({
    source: "book-content",
    ok: bookMetadata.commonTerms.length > 0,
    count: bookMetadata.commonTerms.length,
  });
  sourceStatuses.push({
    source: "open-library",
    ok: bookMetadata.subjects.length > 0,
    count: bookMetadata.subjects.length,
  });

  const genreMetadataCandidates = buildGenreMetadataCandidates(bookMetadata);
  const bookContentCandidates = buildBookContentCandidates(bookMetadata.commonTerms);
  const compTitleCandidates = mergeKeywordCandidates(
    buildCompTitleCandidates(productPage),
    buildCategoryCandidates(relatedCategories, "comp-title")
  );
  const buyerIntentCandidates = buildBuyerIntentCandidates(
    genreMetadataCandidates.map((c) => c.text),
    productPage.title
  );

  sourceStatuses.push({
    source: "comp-title",
    ok: compTitleCandidates.length > 0,
    count: compTitleCandidates.length,
  });
  sourceStatuses.push({
    source: "genre-metadata",
    ok: genreMetadataCandidates.length > 0,
    count: genreMetadataCandidates.length,
  });
  sourceStatuses.push({
    source: "buyer-intent",
    ok: buyerIntentCandidates.length > 0,
    count: buyerIntentCandidates.length,
  });

  const keywords = finalizeKeywords(
    [
      adsApiResult.candidates,
      autocompleteResult,
      googleAutocompleteResult,
      compTitleCandidates,
      genreMetadataCandidates,
      bookContentCandidates,
      buyerIntentCandidates,
    ],
    request.defaultBid
  );

  if (keywords.length === 0) {
    return NextResponse.json(
      {
        error:
          "No keyword candidates could be generated for this ASIN. All sources failed or returned nothing.",
        sources: sourceStatuses,
      },
      { status: 502 }
    );
  }

  const buffer = await buildBulksheet(request, keywords);
  const filename = `${request.campaignName.replace(/[^a-z0-9\-_]+/gi, "_")}-bulksheet.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Keyword-Count": String(keywords.length),
      "X-Source-Status": encodeURIComponent(JSON.stringify(sourceStatuses)),
    },
  });
}
