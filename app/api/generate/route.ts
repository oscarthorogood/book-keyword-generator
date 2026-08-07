import { NextRequest, NextResponse } from "next/server";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { isAiRankingConfigured, mergeAiRanking, rankKeywordsWithAi } from "@/lib/aiRanker";
import { AD_GROUP_BID_MULTIPLIER, computeMaxCpc, round2 } from "@/lib/bidding";
import { KEYWORD_CONFIG } from "@/lib/config";
import {
  enrichBookMetadata,
  lookupLocSubjects,
  lookupWikidataGenres,
  lookupWikipediaCategories,
} from "@/lib/bookMetadata";
import { buildBulksheet, SpmAdGroup } from "@/lib/bulksheet";
import { getSynonymExpansionCandidates } from "@/lib/datamuse";
import { isFirecrawlConfigured, scrapeMarkdown } from "@/lib/firecrawl";
import { buildGoodreadsTagCandidates, getGoodreadsTags } from "@/lib/goodreads";
import {
  buildAmazonRecommendationCandidates,
  buildAuthorCatalogCandidates,
  buildBookContentCandidates,
  buildBuyerIntentCandidates,
  buildCompNameCandidates,
  buildCompTitleCandidates,
  buildCuratedSynonymCandidates,
  buildDescriptionCandidates,
  buildDescriptionPhraseCandidates,
  buildFirecrawlCandidates,
  buildGenreMetadataCandidates,
  buildKnownTagCandidates,
  buildLocCandidates,
  buildManualKeywordCandidates,
  buildQnaCandidates,
  buildWikidataCandidates,
  buildWikipediaCandidates,
  boostScoresByCompetitorQuality,
  collapseNearDuplicates,
  COMP_NAME_MAX_KEYWORDS,
  extractAsinCandidates,
  mergeKeywordCandidates,
  RECOMMENDED_MAX_KEYWORDS,
  RECOMMENDED_MIN_KEYWORDS,
  scoreAndTierBids,
  splitKeywordsByCategory,
} from "@/lib/keywordMerge";
import { boostScoresByDescriptionQuality } from "@/lib/descriptionQuality";
import { validateFinalKeywords } from "@/lib/keywordValidation";
import {
  ALL_KEYWORD_CATEGORIES,
  buildCategorizedKeywordCandidates,
  KEYWORD_CATEGORY_META,
} from "@/lib/keywordCategories";
import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { buildAdGroupName, buildCampaignName } from "@/lib/naming";
import {
  buildProductTargetCandidates,
  mergeProductTargetCandidates,
  PRODUCT_TARGET_MAX,
} from "@/lib/productTargets";
import { mineReviewLanguage } from "@/lib/reviewMining";
import {
  buildAutocompleteSeeds,
  buildMetadataSeeds,
  getAutocompleteKeywordSet,
  getDuckDuckGoAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  getProductPageUrl,
  getYoutubeAutocompleteKeywordSet,
  scrapeAuthorCatalog,
  scrapeCustomerQnA,
  scrapeCustomerReviews,
  scrapeProductPage,
  scrapeRelatedCompetitors,
} from "@/lib/scrape";
import {
  BidEconomics,
  GenerateRequest,
  KeywordCandidate,
  KeywordCategory,
  KeywordGroupType,
  KeywordSource,
  Marketplace,
  MatchType,
  SourceStatus,
} from "@/lib/types";

export const runtime = "nodejs";
// Give the autocomplete sweeps (dozens of small outbound requests) room to
// finish; if your Vercel plan caps function duration lower than this, lower
// AUTOCOMPLETE_CONCURRENCY / MAX_AUTOCOMPLETE_SEEDS in lib/scrape.ts instead.
export const maxDuration = 60;

// Import configuration from centralized config file
const MARKETPLACES: Marketplace[] = [...KEYWORD_CONFIG.MARKETPLACES];
const MATCH_TYPES: MatchType[] = [...KEYWORD_CONFIG.MATCH_TYPES];
const ALL_KEYWORD_SOURCES: KeywordSource[] = [...KEYWORD_CONFIG.ALL_KEYWORD_SOURCES];
const ALL_KEYWORD_GROUP_TYPES: KeywordGroupType[] = [...KEYWORD_CONFIG.ALL_KEYWORD_GROUP_TYPES];

// Note: "manual" isn't in ALL_KEYWORD_SOURCES since user-typed keywords are
// always guaranteed a slot regardless of source selection. "key-trope" is
// included and user-togglable like other sources.

function validate(body: unknown): { value: GenerateRequest } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Invalid request body." };
  const b = body as Record<string, unknown>;

  const asin = typeof b.asin === "string" ? normalizeAsinOrIsbn(b.asin) : null;
  if (!asin) {
    return { error: "Enter a valid ASIN, ISBN-10, or ISBN-13." };
  }
  if (typeof b.marketplace !== "string" || !MARKETPLACES.includes(b.marketplace as Marketplace)) {
    return { error: `Marketplace must be one of ${MARKETPLACES.join(", ")}.` };
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

  const seriesName = typeof b.seriesName === "string" && b.seriesName.trim() ? b.seriesName.trim() : undefined;
  const variant =
    typeof b.variant === "number" && Number.isInteger(b.variant) && b.variant > 0 ? b.variant : 1;

  if (
    !Array.isArray(b.matchTypes) ||
    b.matchTypes.length === 0 ||
    !b.matchTypes.every((m) => MATCH_TYPES.includes(m as MatchType))
  ) {
    return { error: "Select at least one match type (broad, phrase, exact)." };
  }
  const matchTypes = b.matchTypes as MatchType[];

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

  const knownTags =
    Array.isArray(b.knownTags) && b.knownTags.every((t) => typeof t === "string")
      ? (b.knownTags as string[]).map((t) => t.trim()).filter(Boolean)
      : undefined;

  // Omitted entirely = every source; present-but-empty = the user
  // deliberately deselected all of them (rely on manual keywords alone).
  const sources: KeywordSource[] = Array.isArray(b.sources)
    ? (b.sources as unknown[]).filter(
        (s): s is KeywordSource => typeof s === "string" && ALL_KEYWORD_SOURCES.includes(s as KeywordSource)
      )
    : ALL_KEYWORD_SOURCES;

  const keywordTypesRaw = Array.isArray(b.keywordTypes) ? b.keywordTypes : ALL_KEYWORD_GROUP_TYPES;
  if (
    keywordTypesRaw.length === 0 ||
    !keywordTypesRaw.every((t) => ALL_KEYWORD_GROUP_TYPES.includes(t as KeywordGroupType))
  ) {
    return {
      error: "Select at least one keyword type (Tropes & Themes, Comp Authors & Titles, Product Targeting).",
    };
  }
  const keywordTypes = keywordTypesRaw as KeywordGroupType[];

  const manualKeywords = Array.isArray(b.manualKeywords)
    ? (b.manualKeywords as unknown[])
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 100)
    : [];

  const keywordCategories: KeywordCategory[] = Array.isArray(b.keywordCategories)
    ? (b.keywordCategories as unknown[]).filter(
        (c): c is KeywordCategory =>
          typeof c === "string" && ALL_KEYWORD_CATEGORIES.includes(c as KeywordCategory)
      )
    : ALL_KEYWORD_CATEGORIES;

  const keyTropes = Array.isArray(b.keyTropes)
    ? (b.keyTropes as unknown[])
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 50)
    : [];

  return {
    value: {
      asin,
      marketplace: b.marketplace as Marketplace,
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
      knownTags,
      sources,
      keywordTypes,
      manualKeywords,
      keywordCategories,
      keyTropes,
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

  const sourceStatuses: SourceStatus[] = [];

  const productPage = await scrapeProductPage(request.asin, request.marketplace);
  sourceStatuses.push({
    source: "product-page",
    ok: !!productPage.title,
    count: productPage.compTitles.length,
    error: productPage.title ? undefined : "Could not load or parse the product page.",
  });

  const seedTerms = buildAutocompleteSeeds(request.bookTitle, request.authorName);

  const [
    adsApiResult,
    firecrawlExtraction,
    autocompleteResult,
    googleAutocompleteResult,
    youtubeAutocompleteResult,
    duckDuckGoAutocompleteResult,
    bookMetadata,
    relatedCompetitors,
    firecrawlMarkdown,
    qnaQuestions,
    reviewBodies,
    authorCatalogTitles,
    wikipediaCategories,
    wikidataGenres,
    locSubjects,
  ] = await Promise.all([
    isAdsApiConfigured()
      ? getAdsApiKeywordRecommendations(request.asin, request.marketplace)
          .then((candidates) => ({ candidates, error: undefined as string | undefined }))
          .catch((err: Error) => ({ candidates: [] as KeywordCandidate[], error: err.message }))
      : Promise.resolve({
          candidates: [] as KeywordCandidate[],
          error: "Amazon Ads API credentials not configured.",
        }),
    buildMetadataSeeds(request.asin, request.marketplace),
    getAutocompleteKeywordSet(seedTerms, request.marketplace),
    getGoogleAutocompleteKeywordSet(seedTerms),
    getYoutubeAutocompleteKeywordSet(seedTerms),
    getDuckDuckGoAutocompleteKeywordSet(seedTerms),
    enrichBookMetadata({
      isbn10: productPage.isbn10,
      isbn13: productPage.isbn13,
      title: request.bookTitle,
      author: request.authorName,
    }),
    // Deep "also bought" crawl (manual research blueprint, section 3) —
    // goes a hop past the target book's own carousel to approximate the
    // blueprint's best-seller deep dive, bounded for serverless time.
    scrapeRelatedCompetitors(request.asin, productPage.compAsins, request.marketplace),
    // Richer natural-language context for the AI ranking pass below — not
    // used for structured extraction (see lib/firecrawl.ts).
    isFirecrawlConfigured()
      ? scrapeMarkdown(getProductPageUrl(request.asin, request.marketplace))
      : Promise.resolve(undefined),
    scrapeCustomerQnA(request.asin, request.marketplace),
    scrapeCustomerReviews(request.asin, request.marketplace),
    productPage.authorUrl
      ? scrapeAuthorCatalog(productPage.authorUrl, request.asin)
      : Promise.resolve([] as string[]),
    lookupWikipediaCategories(request.bookTitle),
    lookupWikidataGenres(request.bookTitle),
    lookupLocSubjects(request.bookTitle),
  ]);

  // Run additional autocomplete queries using Firecrawl-extracted metadata seeds
  // to capture category-specific and feature-based search queries
  const metadataSeeds = firecrawlExtraction.seeds;
  const metadataAwareAutocompleteResults = await Promise.all([
    metadataSeeds.length > 0 ? getAutocompleteKeywordSet(metadataSeeds, request.marketplace) : Promise.resolve([]),
    metadataSeeds.length > 0 ? getGoogleAutocompleteKeywordSet(metadataSeeds) : Promise.resolve([]),
    metadataSeeds.length > 0 ? getYoutubeAutocompleteKeywordSet(metadataSeeds) : Promise.resolve([]),
    metadataSeeds.length > 0 ? getDuckDuckGoAutocompleteKeywordSet(metadataSeeds) : Promise.resolve([]),
  ]);

  // Merge metadata-aware autocomplete results with original results
  const mergedAutocompleteResult = [...autocompleteResult, ...metadataAwareAutocompleteResults[0]];
  const mergedGoogleAutocompleteResult = [...googleAutocompleteResult, ...metadataAwareAutocompleteResults[1]];
  const mergedYoutubeAutocompleteResult = [...youtubeAutocompleteResult, ...metadataAwareAutocompleteResults[2]];
  const mergedDuckDuckGoAutocompleteResult = [...duckDuckGoAutocompleteResult, ...metadataAwareAutocompleteResults[3]];

  sourceStatuses.push({
    source: "ads-api",
    ok: adsApiResult.candidates.length > 0,
    count: adsApiResult.candidates.length,
    error: adsApiResult.error,
  });
  sourceStatuses.push({
    source: "autocomplete",
    ok: mergedAutocompleteResult.length > 0,
    count: mergedAutocompleteResult.length,
  });
  sourceStatuses.push({
    source: "google-autocomplete",
    ok: mergedGoogleAutocompleteResult.length > 0,
    count: mergedGoogleAutocompleteResult.length,
  });
  sourceStatuses.push({
    source: "youtube-autocomplete",
    ok: mergedYoutubeAutocompleteResult.length > 0,
    count: mergedYoutubeAutocompleteResult.length,
  });
  sourceStatuses.push({
    source: "duckduckgo-autocomplete",
    ok: mergedDuckDuckGoAutocompleteResult.length > 0,
    count: mergedDuckDuckGoAutocompleteResult.length,
  });
  sourceStatuses.push({
    source: "book-content",
    ok: bookMetadata.commonTerms.length > 0,
    count: bookMetadata.commonTerms.length,
  });

  // Auto-targeting's complements/substitutes clauses match against other
  // *products*, so some "search terms" here are actually bare ASINs — route
  // those to product targeting instead of letting them fall out as junk
  // keywords. See learnings doc, section 3.
  const { keywords: adsApiKeywords, asins: adsApiAsins } = extractAsinCandidates(adsApiResult.candidates);
  const { keywords: autocompleteKeywords, asins: autocompleteAsins } = extractAsinCandidates(mergedAutocompleteResult);
  const { keywords: googleAutocompleteKeywords, asins: googleAsins } = extractAsinCandidates(
    mergedGoogleAutocompleteResult
  );

  const genreMetadataCandidates = buildGenreMetadataCandidates(bookMetadata);
  const bookContentCandidates = buildBookContentCandidates(bookMetadata.commonTerms);
  // Mixed source tags: the comp titles' own titles are "comp-name" (bare
  // name, high intent), their category placement is "comp-title" (thematic).
  const compTitleCandidates = buildCompTitleCandidates(productPage);
  const deepCompNameCandidates = buildCompNameCandidates(relatedCompetitors.competitors);
  // The author's other books on Amazon — a stronger-signal replacement for a
  // WorldCat lookup (its free API tier is discontinued). Tagged "comp-name"
  // internally for ad-group routing, tracked under its own "author-catalog"
  // toggle/status below.
  const authorCatalogCandidates = buildAuthorCatalogCandidates(authorCatalogTitles);
  // Amazon's own "frequently bought together" (co-purchase) and "compare with
  // similar items" (explicit substitutes) modules — stronger comparable-title
  // signals than the "also bought" carousel, already scraped alongside it.
  const amazonRecsCandidates = buildAmazonRecommendationCandidates([
    productPage.frequentlyBoughtTogether,
    productPage.compareWithSimilar,
  ]);
  // The LLM extraction that already ran to seed the metadata-aware
  // autocomplete sweep above, mined for its own terms this time.
  const firecrawlCandidates = buildFirecrawlCandidates(firecrawlExtraction.metadata);
  // Tags the user reviewed/kept on the Autofill book profile — high-trust,
  // human-vetted genre/subgenre/tag signal, folded into both the seed terms
  // below and the final candidate pool. See buildKnownTagCandidates.
  const knownTagCandidates = buildKnownTagCandidates(request.knownTags ?? []);
  const genreSeedTerms = [...genreMetadataCandidates.map((c) => c.text), ...(request.knownTags ?? [])];
  const buyerIntentCandidates = buildBuyerIntentCandidates(genreSeedTerms, {
    title: request.bookTitle,
    author: request.authorName,
    seriesName: request.seriesName,
  });
  // Publisher/author's own blurb — comp mentions ("perfect for fans of X")
  // and short marketing bullets taken as-is, plus RAKE-mined phrases from the
  // full description prose (buildDescriptionPhraseCandidates) for additional
  // coverage the bullet/comp-mention extraction alone misses.
  const descriptionCandidates = [
    ...buildDescriptionCandidates(productPage.description, productPage.bulletPoints),
    ...buildDescriptionPhraseCandidates(productPage.description),
  ];
  // Real reader Q&A phrasing — a natural-language buyer register distinct
  // from both review text and autocomplete.
  const qnaCandidates = buildQnaCandidates(qnaQuestions);
  // Pools review text across the seed book's embedded snippets, every
  // deep-crawled comp title, *and* the seed book's own dedicated reviews
  // page (richer/fuller bodies than what's embedded on the product page).
  const reviewLanguageCandidates = mineReviewLanguage([
    ...productPage.reviewSnippets,
    ...relatedCompetitors.reviewSnippets,
    ...reviewBodies,
  ]);
  const wikipediaCandidates = buildWikipediaCandidates(wikipediaCategories);
  const wikidataCandidates = buildWikidataCandidates(wikidataGenres);
  const locCandidates = buildLocCandidates(locSubjects);

  // More free, low-risk sources: Datamuse (a real API, no scraping risk) and
  // a curated book-genre thesaurus (lib/synonyms.ts, fully offline) for
  // synonym expansion of the genre/trope terms already found (now including
  // user-curated tags), and a best-effort Goodreads lookup for
  // community-tagged tropes/genres — the richest free source of exact
  // fiction reader vocabulary, but a scrape with the same fragility/blocking
  // caveats as the Amazon ones above.
  const [datamuseSynonymCandidates, goodreadsTags] = await Promise.all([
    getSynonymExpansionCandidates(genreSeedTerms),
    getGoodreadsTags(productPage.isbn10, request.bookTitle, request.authorName),
  ]);
  const synonymCandidates = [...datamuseSynonymCandidates, ...buildCuratedSynonymCandidates(genreSeedTerms)];
  const goodreadsTagCandidates = buildGoodreadsTagCandidates(goodreadsTags);

  sourceStatuses.push({
    source: "comp-title",
    ok: compTitleCandidates.length > 0,
    count: compTitleCandidates.length,
  });
  sourceStatuses.push({
    source: "comp-name",
    ok: deepCompNameCandidates.length > 0,
    count: deepCompNameCandidates.length,
  });
  sourceStatuses.push({
    source: "genre-metadata",
    ok: genreMetadataCandidates.length > 0,
    count: genreMetadataCandidates.length,
  });
  sourceStatuses.push({
    source: "user-tag",
    ok: knownTagCandidates.length > 0,
    count: knownTagCandidates.length,
  });
  sourceStatuses.push({
    source: "buyer-intent",
    ok: buyerIntentCandidates.length > 0,
    count: buyerIntentCandidates.length,
  });
  sourceStatuses.push({
    source: "book-description",
    ok: descriptionCandidates.length > 0,
    count: descriptionCandidates.length,
  });
  sourceStatuses.push({
    source: "review-language",
    ok: reviewLanguageCandidates.length > 0,
    count: reviewLanguageCandidates.length,
  });
  sourceStatuses.push({
    source: "customer-qna",
    ok: qnaCandidates.length > 0,
    count: qnaCandidates.length,
  });
  sourceStatuses.push({
    source: "synonym",
    ok: synonymCandidates.length > 0,
    count: synonymCandidates.length,
  });
  sourceStatuses.push({
    source: "wikipedia",
    ok: wikipediaCandidates.length > 0,
    count: wikipediaCandidates.length,
  });
  sourceStatuses.push({
    source: "wikidata",
    ok: wikidataCandidates.length > 0,
    count: wikidataCandidates.length,
  });
  sourceStatuses.push({
    source: "loc-subjects",
    ok: locCandidates.length > 0,
    count: locCandidates.length,
  });
  sourceStatuses.push({
    source: "author-catalog",
    ok: authorCatalogCandidates.length > 0,
    count: authorCatalogCandidates.length,
  });
  sourceStatuses.push({
    source: "goodreads-tags",
    ok: goodreadsTagCandidates.length > 0,
    count: goodreadsTagCandidates.length,
  });
  sourceStatuses.push({
    source: "amazon-recs",
    ok: amazonRecsCandidates.length > 0,
    count: amazonRecsCandidates.length,
    error:
      amazonRecsCandidates.length > 0
        ? undefined
        : "No 'frequently bought together' or 'compare with similar' modules on this page.",
  });
  sourceStatuses.push({
    source: "firecrawl",
    ok: firecrawlCandidates.length > 0,
    count: firecrawlCandidates.length,
    error: isFirecrawlConfigured()
      ? firecrawlCandidates.length > 0
        ? undefined
        : "Firecrawl returned no categories, keywords, or features."
      : "FIRECRAWL_API_KEY not configured.",
  });

  // ASINs can leak into the newer autocomplete corpora the same way they do
  // for Amazon/Google's — see the extractAsinCandidates call above.
  const { keywords: youtubeAutocompleteKeywords, asins: youtubeAsins } = extractAsinCandidates(
    mergedYoutubeAutocompleteResult
  );
  const { keywords: duckDuckGoAutocompleteKeywords, asins: duckDuckGoAsins } = extractAsinCandidates(
    mergedDuckDuckGoAutocompleteResult
  );

  // Build categorized keyword candidates from the 20-category semantic taxonomy.
  const reviewLanguagePhrases = reviewLanguageCandidates.map((c) => c.text);
  const categorizedCandidates = buildCategorizedKeywordCandidates({
    title: request.bookTitle,
    author: request.authorName,
    seriesName: request.seriesName,
    genreTerms: genreSeedTerms,
    categoryPath: productPage.categoryPath,
    competitors: relatedCompetitors.competitors,
    compTitles: productPage.compTitles,
    description: productPage.description,
    bulletPoints: productPage.bulletPoints,
    keyTropes: request.keyTropes ?? [],
    goodreadsTags,
    reviewLanguagePhrases,
    enabledCategories: new Set(request.keywordCategories ?? ALL_KEYWORD_CATEGORIES),
  });

  // Track key-trope source status (generated from user-provided tropes)
  const keyTropeCandidates = categorizedCandidates.filter((c) => c.sources.includes("key-trope"));
  sourceStatuses.push({
    source: "key-trope",
    ok: keyTropeCandidates.length > 0,
    count: keyTropeCandidates.length,
  });

  // User-deselected sources still ran (they're entangled with data other
  // sources depend on — see the comment on ALL_KEYWORD_SOURCES), but their
  // candidates are excluded from the merge below, and their status entry
  // here is overwritten so the UI doesn't imply they contributed keywords.
  const enabledSources = new Set(request.sources);
  const sourceCandidateGroups: Partial<Record<KeywordSource, KeywordCandidate[]>> = {
    "ads-api": adsApiKeywords,
    autocomplete: autocompleteKeywords,
    "google-autocomplete": googleAutocompleteKeywords,
    "youtube-autocomplete": youtubeAutocompleteKeywords,
    "duckduckgo-autocomplete": duckDuckGoAutocompleteKeywords,
    "comp-title": compTitleCandidates,
    "comp-name": deepCompNameCandidates,
    "author-catalog": authorCatalogCandidates,
    "user-tag": knownTagCandidates,
    "genre-metadata": genreMetadataCandidates,
    "book-content": bookContentCandidates,
    "buyer-intent": buyerIntentCandidates,
    "book-description": descriptionCandidates,
    "review-language": reviewLanguageCandidates,
    "customer-qna": qnaCandidates,
    synonym: synonymCandidates,
    wikipedia: wikipediaCandidates,
    wikidata: wikidataCandidates,
    "loc-subjects": locCandidates,
    "goodreads-tags": goodreadsTagCandidates,
    "amazon-recs": amazonRecsCandidates,
    firecrawl: firecrawlCandidates,
  };
  for (const status of sourceStatuses) {
    if (status.source in sourceCandidateGroups && !enabledSources.has(status.source as KeywordSource)) {
      status.ok = false;
      status.error = "Deselected — not used for this generation.";
    }
  }

  // Free-typed additions from the search bar — guaranteed a slot further
  // down, so kept out of this merge (which feeds the scored/capped
  // shortlist) and handled separately after ranking.
  const { keywords: manualKeywordCandidates, asins: manualAsins } = extractAsinCandidates(
    buildManualKeywordCandidates(request.manualKeywords ?? [])
  );
  sourceStatuses.push({
    source: "manual",
    ok: manualKeywordCandidates.length + manualAsins.length > 0,
    count: manualKeywordCandidates.length + manualAsins.length,
  });

  // Merge + dedupe everything once, then split into the two Manual ad group
  // buckets the research blueprint recommends tracking separately (section
  // 5) and score/cap each independently — a strong comp-author name
  // shouldn't lose its ad group slot to a flood of tropes candidates sharing
  // one combined cap. Include categorized candidates alongside structured sources,
  // but filter them to only include enabled sources.
  const filteredCategorizedCandidates = categorizedCandidates.filter((c) =>
    c.sources.some((source) => enabledSources.has(source))
  );
  const merged = mergeKeywordCandidates(
    ...ALL_KEYWORD_SOURCES.filter((s) => enabledSources.has(s)).map((s) => sourceCandidateGroups[s] ?? []),
    filteredCategorizedCandidates
  );
  const { tropes: tropesCandidates, compNames: compNameCandidates } = splitKeywordsByCategory(
    collapseNearDuplicates(merged)
  );

  const tropesBid = round2(baseBid * AD_GROUP_BID_MULTIPLIER.tropes);
  const compNamesBid = round2(baseBid * AD_GROUP_BID_MULTIPLIER["comp-names"]);
  const productTargetingBid = round2(baseBid * AD_GROUP_BID_MULTIPLIER["product-targeting"]);

  // Heuristic scoring narrows the raw candidate pool down to a shortlist
  // first — real headroom above the final cap, so the AI pass (if
  // configured) has genuine judgment calls to make rather than rubber-
  // stamping an already-final list. This is also the sole path when AI
  // ranking isn't configured, so it has to be a complete, good-enough
  // ranking on its own, not just AI scaffolding.
  const AI_SHORTLIST_MULTIPLIER = 1.6;
  let tropesShortlist = scoreAndTierBids(tropesCandidates, tropesBid, request.knownTags);

  // Boost tropes keywords based on description quality (richer descriptions
  // = better keyword signals from that marketing copy)
  tropesShortlist = boostScoresByDescriptionQuality(
    tropesShortlist,
    {
      description: productPage.description,
      bulletPoints: productPage.bulletPoints,
    },
    "book-description"
  ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  tropesShortlist = tropesShortlist.slice(
    0,
    Math.round(RECOMMENDED_MAX_KEYWORDS * AI_SHORTLIST_MULTIPLIER)
  );

  // Boost comp-name keywords based on competitor book quality (bestseller
  // status, ratings, review counts) — makes sure high-quality competitors
  // are prioritized over unknowns.
  const scoredCompNames = scoreAndTierBids(compNameCandidates, compNamesBid, request.knownTags);
  const qualityBoostedCompNames = boostScoresByCompetitorQuality(
    scoredCompNames,
    relatedCompetitors.competitors,
    0.2 // Up to 20% score boost for keywords from bestsellers
  );
  const compNamesShortlist = qualityBoostedCompNames.slice(
    0,
    Math.round(COMP_NAME_MAX_KEYWORDS * AI_SHORTLIST_MULTIPLIER)
  );

  let tropesKeywords: KeywordCandidate[];
  let compNameKeywords: KeywordCandidate[];
  let aiRankingUsed = false;

  if (isAiRankingConfigured()) {
    const ranked = await rankKeywordsWithAi(
      {
        title: request.bookTitle,
        author: request.authorName,
        seriesName: request.seriesName,
        genreTerms: genreSeedTerms,
        description: productPage.description,
        pageMarkdown: firecrawlMarkdown,
      },
      tropesShortlist,
      compNamesShortlist
    );

    if (ranked) {
      const combinedShortlist = [...tropesShortlist, ...compNamesShortlist];
      tropesKeywords = mergeAiRanking(combinedShortlist, ranked, "tropes", RECOMMENDED_MAX_KEYWORDS);
      compNameKeywords = mergeAiRanking(combinedShortlist, ranked, "comp-names", COMP_NAME_MAX_KEYWORDS);
      aiRankingUsed = true;
    } else {
      tropesKeywords = tropesShortlist.slice(0, RECOMMENDED_MAX_KEYWORDS);
      compNameKeywords = compNamesShortlist.slice(0, COMP_NAME_MAX_KEYWORDS);
    }
  } else {
    tropesKeywords = tropesShortlist.slice(0, RECOMMENDED_MAX_KEYWORDS);
    compNameKeywords = compNamesShortlist.slice(0, COMP_NAME_MAX_KEYWORDS);
  }

  // Final quality validation pass: removes ultra-generic keywords, penalizes
  // format-only keywords, and drops over-extracted full-title scrapes.
  tropesKeywords = validateFinalKeywords(tropesKeywords, tropesBid);
  compNameKeywords = validateFinalKeywords(compNameKeywords, compNamesBid);

  // Manually-added keywords bypass scoring/caps entirely — the user typed
  // them on purpose, so neither the heuristic scorer nor the AI pass gets a
  // vote on whether they survive. Prepended so they sort first in the
  // Bulksheet (best-first ordering), at the ad group's full base bid rather
  // than a source-agreement-discounted one.
  const existingTropesText = new Set(tropesKeywords.map((k) => k.text.toLowerCase()));
  const guaranteedManualKeywords = manualKeywordCandidates
    .filter((k) => !existingTropesText.has(k.text.toLowerCase()))
    .map((k) => ({ ...k, suggestedBid: tropesBid }));
  tropesKeywords = [...guaranteedManualKeywords, ...tropesKeywords];

  // Product targeting isn't just the whole targeting story on its own either
  // — comp ASINs from the product page carousel, the deep crawl's first- and
  // second-hop ASINs, plus any ASIN-shaped "keywords" pulled out above (now
  // including any the user typed directly into the search bar). See
  // learnings doc, section 4.
  const productTargets = mergeProductTargetCandidates(
    // First: merge order is preserved and the list is capped at
    // PRODUCT_TARGET_MAX below, so the strongest signal has to lead. An ASIN
    // Amazon itself bundles or offers as a substitute outranks a carousel
    // impression for product targeting.
    buildProductTargetCandidates(
      [
        ...(productPage.frequentlyBoughtTogether ?? []).map((item) => item.asin),
        ...(productPage.compareWithSimilar ?? []).map((item) => item.asin),
      ],
      "amazon-recs"
    ),
    buildProductTargetCandidates(productPage.compAsins, "comp-title"),
    buildProductTargetCandidates(relatedCompetitors.productTargetAsins, "comp-title"),
    buildProductTargetCandidates(
      [...adsApiAsins, ...autocompleteAsins, ...googleAsins, ...youtubeAsins, ...duckDuckGoAsins],
      "autocomplete"
    ),
    buildProductTargetCandidates(manualAsins, "manual")
  ).slice(0, PRODUCT_TARGET_MAX);

  // Only the ad groups the user selected make it into the Bulksheet — an
  // empty bucket for a deselected type isn't an error, it's the ask.
  const keywordTypes = new Set(request.keywordTypes);
  const adGroups: SpmAdGroup[] = [];
  if (keywordTypes.has("tropes")) {
    adGroups.push({
      name: buildAdGroupName("tropes"),
      defaultBid: tropesBid,
      keywords: tropesKeywords,
      matchTypes: request.matchTypes,
    });
  }
  if (keywordTypes.has("comp-names")) {
    adGroups.push({
      name: buildAdGroupName("comp-names"),
      defaultBid: compNamesBid,
      keywords: compNameKeywords,
      // Blueprint: Competitor Authors & Titles ad group is Exact Match only
      // — readers searching a name are ready to buy, don't dilute with Broad.
      matchTypes: ["exact"],
    });
  }
  if (keywordTypes.has("product-targeting")) {
    adGroups.push({
      name: buildAdGroupName("product-targeting"),
      defaultBid: productTargetingBid,
      productTargets,
    });
  }

  const hasAnyResult = adGroups.some(
    (g) => (g.keywords?.length ?? 0) > 0 || (g.productTargets?.length ?? 0) > 0
  );
  if (!hasAnyResult) {
    return NextResponse.json(
      {
        error:
          "No keyword or product-targeting candidates could be generated for the selected keyword types and sources. All sources failed, returned nothing, or were deselected.",
        sources: sourceStatuses,
      },
      { status: 502 }
    );
  }

  const buffer = await buildBulksheet({
    campaignName,
    asin: request.asin,
    dailyBudget: request.dailyBudget,
    startDate: request.startDate,
    baseBid,
    adGroups,
  });

  // Report counts for what's actually in the file — 0 for a deselected ad
  // group, not the number that was computed but left out.
  const finalTropesCount = keywordTypes.has("tropes") ? tropesKeywords.length : 0;
  const finalCompNameCount = keywordTypes.has("comp-names") ? compNameKeywords.length : 0;
  const finalProductTargetCount = keywordTypes.has("product-targeting") ? productTargets.length : 0;

  return fileResponse(buffer, campaignName, {
    "X-Keyword-Count": String(finalTropesCount + finalCompNameCount),
    "X-Tropes-Keyword-Count": String(finalTropesCount),
    "X-Comp-Name-Keyword-Count": String(finalCompNameCount),
    "X-Product-Target-Count": String(finalProductTargetCount),
    "X-Manual-Keyword-Count": String(guaranteedManualKeywords.length + (manualAsins.length > 0 ? manualAsins.length : 0)),
    "X-Recommended-Keyword-Range": `${RECOMMENDED_MIN_KEYWORDS}-${RECOMMENDED_MAX_KEYWORDS}`,
    "X-Source-Status": encodeURIComponent(JSON.stringify(sourceStatuses)),
    "X-Ai-Ranking-Used": String(aiRankingUsed),
    "X-Firecrawl-Used": String(!!firecrawlMarkdown),
  });
}
