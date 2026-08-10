import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { isAiRankingConfigured, mergeAiRanking, rankKeywordsWithAi } from "@/lib/aiRanker";
import {
  enrichBookMetadata,
  lookupLocSubjects,
  lookupWikidataGenres,
  lookupWikipediaCategories,
} from "@/lib/bookMetadata";
import { getSynonymExpansionCandidates } from "@/lib/datamuse";
import { boostScoresByDescriptionQuality } from "@/lib/descriptionQuality";
import { isFirecrawlConfigured, scrapeMarkdown } from "@/lib/firecrawl";
import { buildGoodreadsTagCandidates, getGoodreadsTags } from "@/lib/goodreads";
import {
  ALL_KEYWORD_CATEGORIES,
  buildCategorizedKeywordCandidates,
} from "@/lib/keywordCategories";
import {
  boostScoresByCompetitorQuality,
  buildAmazonRecommendationCandidates,
  buildAuthorCatalogCandidates,
  buildBookContentCandidates,
  buildBuyerIntentCandidates,
  buildCompNameCandidates,
  buildCompTitleCandidates,
  buildCuratedSynonymCandidates,
  buildDescriptionCandidates,
  buildDescriptionMetadataCandidates,
  buildDescriptionPhraseCandidates,
  buildFirecrawlCandidates,
  buildGenreMetadataCandidates,
  buildKnownTagCandidates,
  buildLocCandidates,
  buildQnaCandidates,
  buildReviewGenreIndicators,
  buildSyntheticGenreKeywords,
  buildWikidataCandidates,
  buildWikipediaCandidates,
  collapseNearDuplicates,
  COMP_NAME_MAX_KEYWORDS,
  extractAsinCandidates,
  mergeKeywordCandidates,
  RECOMMENDED_MAX_KEYWORDS,
  scoreAndTierBids,
  splitKeywordsByCategory,
} from "@/lib/keywordMerge";
import { validateFinalKeywords } from "@/lib/keywordValidation";
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
import { KeywordCandidate, KeywordCategory, KeywordSource, Marketplace } from "@/lib/types";

export const runtime = "nodejs";
// Same rationale as the old campaign pipeline: dozens of small outbound
// scrape/lookup requests across every source below need room to finish.
export const maxDuration = 60;

const ALL_KEYWORD_SOURCES: KeywordSource[] = [
  "ads-api",
  "autocomplete",
  "google-autocomplete",
  "youtube-autocomplete",
  "duckduckgo-autocomplete",
  "comp-title",
  "comp-name",
  "author-catalog",
  "genre-metadata",
  "book-content",
  "buyer-intent",
  "book-description",
  "review-language",
  "customer-qna",
  "synonym",
  "wikipedia",
  "wikidata",
  "loc-subjects",
  "goodreads-tags",
  "amazon-recs",
  "firecrawl",
  "user-tag",
  "key-trope",
];

/**
 * POST /api/books/[id]/keywords/generate
 * Runs the book through the full multi-source keyword pipeline (the same
 * ~20+ sources the old campaign generator used: Ads API recommendations,
 * four autocomplete engines, deep "also bought" competitor crawl, author
 * catalog, genre/Wikipedia/Wikidata/LoC metadata, buyer-intent templating,
 * description/review/Q&A mining, Datamuse + curated synonyms, Goodreads
 * tags, Amazon's own recs modules, and optional Firecrawl/AI ranking) and
 * inserts the resulting shortlist straight into the keywords table —
 * a book-scoped, campaign-free version of the old /api/generate pipeline.
 * Body: { keyTropes?: string[], knownTags?: string[], keywordCategories?: KeywordCategory[], defaultBid?: number, sources?: KeywordSource[] }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id, asin, marketplace, title, author")
      .eq("id", bookId)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const keyTropes: string[] = Array.isArray(body.keyTropes)
      ? body.keyTropes.filter((t: unknown): t is string => typeof t === "string").slice(0, 50)
      : [];
    const knownTags: string[] = Array.isArray(body.knownTags)
      ? body.knownTags.filter((t: unknown): t is string => typeof t === "string").slice(0, 50)
      : [];
    const keywordCategories: KeywordCategory[] = Array.isArray(body.keywordCategories)
      ? body.keywordCategories.filter((c: unknown): c is KeywordCategory =>
          typeof c === "string" && ALL_KEYWORD_CATEGORIES.includes(c as KeywordCategory)
        )
      : ALL_KEYWORD_CATEGORIES;
    const enabledSources = new Set<KeywordSource>(
      Array.isArray(body.sources)
        ? body.sources.filter((s: unknown): s is KeywordSource =>
            typeof s === "string" && ALL_KEYWORD_SOURCES.includes(s as KeywordSource)
          )
        : ALL_KEYWORD_SOURCES
    );
    const defaultBid = typeof body.defaultBid === "number" && body.defaultBid > 0 ? body.defaultBid : 0.5;

    const asin = book.asin as string;
    const marketplace = (book.marketplace as Marketplace) || "US";
    const bookTitle = book.title as string;
    const authorName = book.author as string;

    const productPage = await scrapeProductPage(asin, marketplace);
    const seedTerms = buildAutocompleteSeeds(bookTitle, authorName);

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
        ? getAdsApiKeywordRecommendations(asin, marketplace)
            .then((candidates) => ({ candidates, error: undefined as string | undefined }))
            .catch((err: Error) => ({ candidates: [] as KeywordCandidate[], error: err.message }))
        : Promise.resolve({ candidates: [] as KeywordCandidate[], error: "Amazon Ads API credentials not configured." }),
      buildMetadataSeeds(asin, marketplace),
      getAutocompleteKeywordSet(seedTerms, marketplace),
      getGoogleAutocompleteKeywordSet(seedTerms),
      getYoutubeAutocompleteKeywordSet(seedTerms),
      getDuckDuckGoAutocompleteKeywordSet(seedTerms),
      enrichBookMetadata({
        isbn10: productPage.isbn10,
        isbn13: productPage.isbn13,
        title: bookTitle,
        author: authorName,
      }),
      scrapeRelatedCompetitors(asin, productPage.compAsins, marketplace),
      isFirecrawlConfigured() ? scrapeMarkdown(getProductPageUrl(asin, marketplace)) : Promise.resolve(undefined),
      scrapeCustomerQnA(asin, marketplace),
      scrapeCustomerReviews(asin, marketplace),
      productPage.authorUrl ? scrapeAuthorCatalog(productPage.authorUrl, asin) : Promise.resolve([] as string[]),
      lookupWikipediaCategories(bookTitle),
      lookupWikidataGenres(bookTitle),
      lookupLocSubjects(bookTitle),
    ]);

    // Second sweep of autocomplete using metadata seeds Firecrawl extracted,
    // same as the old pipeline.
    const metadataSeeds = firecrawlExtraction.seeds;
    const metadataAwareAutocompleteResults = await Promise.all([
      metadataSeeds.length > 0 ? getAutocompleteKeywordSet(metadataSeeds, marketplace) : Promise.resolve([]),
      metadataSeeds.length > 0 ? getGoogleAutocompleteKeywordSet(metadataSeeds) : Promise.resolve([]),
      metadataSeeds.length > 0 ? getYoutubeAutocompleteKeywordSet(metadataSeeds) : Promise.resolve([]),
      metadataSeeds.length > 0 ? getDuckDuckGoAutocompleteKeywordSet(metadataSeeds) : Promise.resolve([]),
    ]);

    const mergedAutocompleteResult = [...autocompleteResult, ...metadataAwareAutocompleteResults[0]];
    const mergedGoogleAutocompleteResult = [...googleAutocompleteResult, ...metadataAwareAutocompleteResults[1]];
    const mergedYoutubeAutocompleteResult = [...youtubeAutocompleteResult, ...metadataAwareAutocompleteResults[2]];
    const mergedDuckDuckGoAutocompleteResult = [...duckDuckGoAutocompleteResult, ...metadataAwareAutocompleteResults[3]];

    const { keywords: adsApiKeywords } = extractAsinCandidates(adsApiResult.candidates);
    const { keywords: autocompleteKeywords } = extractAsinCandidates(mergedAutocompleteResult);
    const { keywords: googleAutocompleteKeywords } = extractAsinCandidates(mergedGoogleAutocompleteResult);
    const { keywords: youtubeAutocompleteKeywords } = extractAsinCandidates(mergedYoutubeAutocompleteResult);
    const { keywords: duckDuckGoAutocompleteKeywords } = extractAsinCandidates(mergedDuckDuckGoAutocompleteResult);

    let genreMetadataCandidates = buildGenreMetadataCandidates(bookMetadata);
    if (genreMetadataCandidates.length === 0) {
      genreMetadataCandidates = [
        ...buildDescriptionMetadataCandidates(productPage.description, productPage.bulletPoints),
        ...buildSyntheticGenreKeywords(bookTitle, productPage.description),
      ];
    }

    let bookContentCandidates = buildBookContentCandidates(bookMetadata.commonTerms);
    if (bookContentCandidates.length === 0) {
      bookContentCandidates = buildDescriptionMetadataCandidates(productPage.description, productPage.bulletPoints);
    }

    const compTitleCandidates = buildCompTitleCandidates(productPage);
    const deepCompNameCandidates = buildCompNameCandidates(relatedCompetitors.competitors);
    const authorCatalogCandidates = buildAuthorCatalogCandidates(authorCatalogTitles);
    const amazonRecsCandidates = buildAmazonRecommendationCandidates([
      productPage.frequentlyBoughtTogether,
      productPage.compareWithSimilar,
    ]);
    const firecrawlCandidates = buildFirecrawlCandidates(firecrawlExtraction.metadata);
    const knownTagCandidates = buildKnownTagCandidates(knownTags);
    const genreSeedTerms = [...genreMetadataCandidates.map((c) => c.text), ...knownTags];
    const buyerIntentCandidates = buildBuyerIntentCandidates(genreSeedTerms, {
      title: bookTitle,
      author: authorName,
    });
    const descriptionCandidates = [
      ...buildDescriptionCandidates(productPage.description, productPage.bulletPoints),
      ...buildDescriptionPhraseCandidates(productPage.description),
    ];

    let qnaCandidates = buildQnaCandidates(qnaQuestions);
    if (qnaCandidates.length === 0 && productPage.reviewSnippets.length > 0) {
      qnaCandidates = buildReviewGenreIndicators(productPage.reviewSnippets);
    }

    let reviewLanguageCandidates = mineReviewLanguage([
      ...productPage.reviewSnippets,
      ...relatedCompetitors.reviewSnippets,
      ...reviewBodies,
    ]);
    if (reviewLanguageCandidates.length === 0 && productPage.reviewSnippets.length > 0) {
      reviewLanguageCandidates = buildReviewGenreIndicators(productPage.reviewSnippets);
    }

    let wikipediaCandidates = buildWikipediaCandidates(wikipediaCategories);
    let wikidataCandidates = buildWikidataCandidates(wikidataGenres);
    if (wikipediaCandidates.length === 0 && wikidataCandidates.length === 0) {
      const syntheticGenres = buildSyntheticGenreKeywords(bookTitle, productPage.description);
      if (syntheticGenres.length > 0) wikidataCandidates = syntheticGenres;
    }

    let locCandidates = buildLocCandidates(locSubjects);
    if (locCandidates.length === 0) {
      locCandidates = buildSyntheticGenreKeywords(bookTitle, productPage.description).slice(0, 5);
    }

    const [datamuseSynonymCandidates, goodreadsTags] = await Promise.all([
      getSynonymExpansionCandidates(genreSeedTerms),
      getGoodreadsTags(productPage.isbn10, bookTitle, authorName),
    ]);
    const synonymCandidates = [...datamuseSynonymCandidates, ...buildCuratedSynonymCandidates(genreSeedTerms)];
    let goodreadsTagCandidates = buildGoodreadsTagCandidates(goodreadsTags);
    if (goodreadsTagCandidates.length === 0 && productPage.reviewSnippets.length > 0) {
      goodreadsTagCandidates = buildReviewGenreIndicators(productPage.reviewSnippets).slice(0, 5);
    }

    const reviewLanguagePhrases = reviewLanguageCandidates.map((c) => c.text);
    const categorizedCandidates = buildCategorizedKeywordCandidates({
      title: bookTitle,
      author: authorName,
      genreTerms: genreSeedTerms,
      categoryPath: productPage.categoryPath ?? [],
      competitors: relatedCompetitors.competitors,
      compTitles: productPage.compTitles ?? [],
      description: productPage.description,
      bulletPoints: productPage.bulletPoints ?? [],
      keyTropes,
      goodreadsTags,
      reviewLanguagePhrases,
      enabledCategories: new Set(keywordCategories),
    });

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

    const AI_SHORTLIST_MULTIPLIER = 1.6;
    let tropesShortlist = scoreAndTierBids(tropesCandidates, defaultBid, knownTags);
    tropesShortlist = boostScoresByDescriptionQuality(
      tropesShortlist,
      { description: productPage.description, bulletPoints: productPage.bulletPoints },
      "book-description"
    ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    tropesShortlist = tropesShortlist.slice(0, Math.round(RECOMMENDED_MAX_KEYWORDS * AI_SHORTLIST_MULTIPLIER));

    const scoredCompNames = scoreAndTierBids(compNameCandidates, defaultBid, knownTags);
    const qualityBoostedCompNames = boostScoresByCompetitorQuality(
      scoredCompNames,
      relatedCompetitors.competitors,
      0.2
    );
    const compNamesShortlist = qualityBoostedCompNames.slice(
      0,
      Math.round(COMP_NAME_MAX_KEYWORDS * AI_SHORTLIST_MULTIPLIER)
    );

    let tropesKeywords: KeywordCandidate[];
    let compNameKeywords: KeywordCandidate[];

    if (isAiRankingConfigured()) {
      const ranked = await rankKeywordsWithAi(
        {
          title: bookTitle,
          author: authorName,
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
      } else {
        tropesKeywords = tropesShortlist.slice(0, RECOMMENDED_MAX_KEYWORDS);
        compNameKeywords = compNamesShortlist.slice(0, COMP_NAME_MAX_KEYWORDS);
      }
    } else {
      tropesKeywords = tropesShortlist.slice(0, RECOMMENDED_MAX_KEYWORDS);
      compNameKeywords = compNamesShortlist.slice(0, COMP_NAME_MAX_KEYWORDS);
    }

    tropesKeywords = validateFinalKeywords(tropesKeywords, defaultBid);
    compNameKeywords = validateFinalKeywords(compNameKeywords, defaultBid);

    const finalCandidates = [...tropesKeywords, ...compNameKeywords];

    if (finalCandidates.length === 0) {
      return Response.json(
        { error: "No keyword candidates could be generated for this book. All sources failed, returned nothing, or were deselected." },
        { status: 502 }
      );
    }

    const rows = finalCandidates.map((c) => ({
      book_id: bookId,
      user_id: user.id,
      text: c.text,
      match_type: "phrase" as const,
      category: c.category ?? null,
      source: c.sources[0] ?? "generated",
      bid: c.suggestedBid ?? defaultBid,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
      .select();

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      generatedCount: finalCandidates.length,
      insertedCount: inserted?.length ?? 0,
      keywords: inserted,
    });
  } catch (err) {
    console.error("Error generating keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
