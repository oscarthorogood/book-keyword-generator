import { NextRequest, NextResponse } from "next/server";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { computeMaxCpc } from "@/lib/bidding";
import { enrichBookMetadata } from "@/lib/bookMetadata";
import { buildBulksheet } from "@/lib/bulksheet";
import {
  buildBookContentCandidates,
  buildBuyerIntentCandidates,
  buildCategoryCandidates,
  buildCompTitleCandidates,
  buildGenreMetadataCandidates,
  extractAsinCandidates,
  finalizeKeywords,
  mergeKeywordCandidates,
  RECOMMENDED_MAX_KEYWORDS,
  RECOMMENDED_MIN_KEYWORDS,
} from "@/lib/keywordMerge";
import { buildAdGroupName, buildCampaignName } from "@/lib/naming";
import { buildProductTargetCandidates, mergeProductTargetCandidates } from "@/lib/productTargets";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  scrapeProductPage,
  scrapeRelatedCategories,
} from "@/lib/scrape";
import {
  BidEconomics,
  CampaignType,
  GenerateRequest,
  KeywordCandidate,
  Marketplace,
  MatchType,
  SourceStatus,
} from "@/lib/types";

export const runtime = "nodejs";
// Give the autocomplete sweeps (dozens of small outbound requests) room to
// finish; if your Vercel plan caps function duration lower than this, lower
// AUTOCOMPLETE_CONCURRENCY / MAX_AUTOCOMPLETE_SEEDS in lib/scrape.ts instead.
export const maxDuration = 60;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];
const MATCH_TYPES: MatchType[] = ["broad", "phrase", "exact"];
const CAMPAIGN_TYPES: CampaignType[] = ["SPA", "SPM"];
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
  if (typeof b.campaignType !== "string" || !CAMPAIGN_TYPES.includes(b.campaignType as CampaignType)) {
    return { error: "Campaign Type must be SPA (Auto) or SPM (Manual)." };
  }
  if (typeof b.creatorInitials !== "string" || !b.creatorInitials.trim()) {
    return { error: "Creator Initials are required — they're baked into the campaign name." };
  }
  if (typeof b.authorName !== "string" || !b.authorName.trim()) {
    return { error: "Author Name is required." };
  }
  if (typeof b.bookTitle !== "string" || !b.bookTitle.trim()) {
    return { error: "Book Title is required." };
  }
  if (typeof b.dailyBudget !== "number" || !Number.isFinite(b.dailyBudget) || b.dailyBudget <= 0) {
    return { error: "Daily Budget must be a positive number." };
  }
  if (typeof b.startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.startDate)) {
    return { error: "Start Date must be in YYYY-MM-DD format." };
  }

  const campaignType = b.campaignType as CampaignType;
  const seriesName = typeof b.seriesName === "string" && b.seriesName.trim() ? b.seriesName.trim() : undefined;
  const variant =
    typeof b.variant === "number" && Number.isInteger(b.variant) && b.variant > 0 ? b.variant : 1;

  let matchTypes: MatchType[] = [];
  if (campaignType === "SPM") {
    if (
      !Array.isArray(b.matchTypes) ||
      b.matchTypes.length === 0 ||
      !b.matchTypes.every((m) => MATCH_TYPES.includes(m as MatchType))
    ) {
      return { error: "Select at least one match type (broad, phrase, exact)." };
    }
    matchTypes = b.matchTypes as MatchType[];
  }

  let bidEconomics: BidEconomics | undefined;
  if (b.bidEconomics && typeof b.bidEconomics === "object") {
    const e = b.bidEconomics as Record<string, unknown>;
    if (
      typeof e.rrp === "number" &&
      e.rrp > 0 &&
      typeof e.targetAcos === "number" &&
      e.targetAcos > 0 &&
      e.targetAcos <= 1 &&
      typeof e.estConversionRate === "number" &&
      e.estConversionRate > 0 &&
      e.estConversionRate <= 1
    ) {
      bidEconomics = { rrp: e.rrp, targetAcos: e.targetAcos, estConversionRate: e.estConversionRate };
    }
  }

  const defaultBid = typeof b.defaultBid === "number" && b.defaultBid > 0 ? b.defaultBid : undefined;

  if (!bidEconomics && defaultBid === undefined) {
    return {
      error:
        "Provide RRP + target ACOS + expected conversion rate to derive a bid, or set a manual Default Bid.",
    };
  }

  return {
    value: {
      asin: b.asin.trim().toUpperCase(),
      marketplace: b.marketplace as Marketplace,
      campaignType,
      creatorInitials: b.creatorInitials.trim(),
      authorName: b.authorName.trim(),
      bookTitle: b.bookTitle.trim(),
      seriesName,
      variant,
      dailyBudget: b.dailyBudget,
      startDate: b.startDate,
      matchTypes,
      bidEconomics,
      defaultBid,
    },
  };
}

function fileResponse(buffer: Buffer, campaignName: string, extraHeaders: Record<string, string>): NextResponse {
  const filename = `${campaignName.replace(/[^a-z0-9\-_]+/gi, "_")}-bulksheet.xlsx`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Campaign-Name": encodeURIComponent(campaignName),
      ...extraHeaders,
    },
  });
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

  const baseBid = request.bidEconomics ? computeMaxCpc(request.bidEconomics) : (request.defaultBid as number);
  const campaignName = buildCampaignName(request);
  const adGroupName = buildAdGroupName(request);

  // Auto (SPA) campaigns are the cheap cold-start step of the two-phase
  // workflow (see learnings doc, section 1) — Amazon's own engine decides
  // targeting, so this skips the entire keyword-research pipeline below and
  // just launches the campaign with tiered bids on the 4 default clauses.
  if (request.campaignType === "SPA") {
    const buffer = await buildBulksheet({
      campaignName,
      adGroupName,
      asin: request.asin,
      campaignType: "SPA",
      dailyBudget: request.dailyBudget,
      startDate: request.startDate,
      baseBid,
    });
    return fileResponse(buffer, campaignName, { "X-Campaign-Type": "SPA" });
  }

  const sourceStatuses: SourceStatus[] = [];

  const productPage = await scrapeProductPage(request.asin, request.marketplace);
  sourceStatuses.push({
    source: "product-page",
    ok: !!productPage.title,
    count: productPage.compTitles.length,
    error: productPage.title ? undefined : "Could not load or parse the product page.",
  });

  const seedTerms = buildAutocompleteSeeds(request.bookTitle, request.authorName);

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
        title: request.bookTitle,
        author: request.authorName,
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

  // Auto-targeting's complements/substitutes clauses match against other
  // *products*, so some "search terms" here are actually bare ASINs — route
  // those to product targeting instead of letting them fall out as junk
  // keywords. See learnings doc, section 3.
  const { keywords: adsApiKeywords, asins: adsApiAsins } = extractAsinCandidates(adsApiResult.candidates);
  const { keywords: autocompleteKeywords, asins: autocompleteAsins } = extractAsinCandidates(autocompleteResult);
  const { keywords: googleAutocompleteKeywords, asins: googleAsins } = extractAsinCandidates(
    googleAutocompleteResult
  );

  const genreMetadataCandidates = buildGenreMetadataCandidates(bookMetadata);
  const bookContentCandidates = buildBookContentCandidates(bookMetadata.commonTerms);
  const compTitleCandidates = mergeKeywordCandidates(
    buildCompTitleCandidates(productPage),
    buildCategoryCandidates(relatedCategories, "comp-title")
  );
  const buyerIntentCandidates = buildBuyerIntentCandidates(genreMetadataCandidates.map((c) => c.text), {
    title: request.bookTitle,
    author: request.authorName,
    seriesName: request.seriesName,
  });

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
      adsApiKeywords,
      autocompleteKeywords,
      googleAutocompleteKeywords,
      compTitleCandidates,
      genreMetadataCandidates,
      bookContentCandidates,
      buyerIntentCandidates,
    ],
    baseBid
  );

  // Product targeting isn't just the whole targeting story on its own either
  // — comp ASINs from the product page carousel plus any ASIN-shaped
  // "keywords" pulled out above. See learnings doc, section 4.
  const productTargets = mergeProductTargetCandidates(
    buildProductTargetCandidates(productPage.compAsins, "comp-title"),
    buildProductTargetCandidates([...adsApiAsins, ...autocompleteAsins, ...googleAsins], "autocomplete")
  );

  if (keywords.length === 0 && productTargets.length === 0) {
    return NextResponse.json(
      {
        error:
          "No keyword or product-targeting candidates could be generated for this ASIN. All sources failed or returned nothing.",
        sources: sourceStatuses,
      },
      { status: 502 }
    );
  }

  const buffer = await buildBulksheet({
    campaignName,
    adGroupName,
    asin: request.asin,
    campaignType: "SPM",
    dailyBudget: request.dailyBudget,
    startDate: request.startDate,
    baseBid,
    matchTypes: request.matchTypes,
    keywords,
    productTargets,
  });

  return fileResponse(buffer, campaignName, {
    "X-Keyword-Count": String(keywords.length),
    "X-Product-Target-Count": String(productTargets.length),
    "X-Recommended-Keyword-Range": `${RECOMMENDED_MIN_KEYWORDS}-${RECOMMENDED_MAX_KEYWORDS}`,
    "X-Source-Status": encodeURIComponent(JSON.stringify(sourceStatuses)),
  });
}
