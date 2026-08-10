import { applyAiRelevance, isAiRankingConfigured, rankKeywordsWithAi } from "@/lib/aiRanker";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import type { BookSnapshot } from "@/lib/bookSnapshot";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { assessCompDataHealth, filterHallucinatedCompKeywords } from "@/lib/compDataValidation";
import { getSynonymExpansionCandidates } from "@/lib/datamuse";
import { boostScoresByDescriptionQuality } from "@/lib/descriptionQuality";
import { genreFamilySearchTerms, genreFamilyThemeTerms } from "@/lib/genre";
import { buildGoodreadsTagCandidates } from "@/lib/goodreads";
import { ALL_KEYWORD_CATEGORIES, buildCategorizedKeywordCandidates } from "@/lib/keywordCategories";
import {
  BOOK_COMP_NAME_MAX,
  BOOK_KEYWORD_MAX,
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
  buildGenreFamilyCandidates,
  buildGenreMetadataCandidates,
  buildKnownTagCandidates,
  buildLocCandidates,
  buildQnaCandidates,
  buildReviewGenreIndicators,
  buildWikidataCandidates,
  buildWikipediaCandidates,
  collapseNearDuplicates,
  extractAsinCandidates,
  mergeKeywordCandidates,
  pickMatchType,
  primaryKeywordSource,
  scoreAndTierBids,
  splitKeywordsByCategory,
} from "@/lib/keywordMerge";
import { validateFinalKeywords } from "@/lib/keywordValidation";
import { mineReviewLanguage } from "@/lib/reviewMining";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  getDuckDuckGoAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  getYoutubeAutocompleteKeywordSet,
} from "@/lib/scrape";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { KeywordCandidate, KeywordCategory, KeywordSource } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * The sources the pipeline draws on. Everything scraped from Amazon (product
 * page, competitors, reviews, Q&A, author catalog) comes from the snapshot
 * captured when the book was added; only the cheap, unblocked endpoints
 * (autocomplete engines, Datamuse, the Ads API) run live per generate.
 */
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

/** Candidate groups built purely from the stored snapshot — no network calls. */
function buildSnapshotCandidates(
  snapshot: BookSnapshot,
  keyTropes: string[],
  knownTags: string[],
  keywordCategories: KeywordCategory[]
): {
  groups: Partial<Record<KeywordSource, KeywordCandidate[]>>;
  categorized: KeywordCandidate[];
  genreSeedTerms: string[];
} {
  const familySearchTerms = genreFamilySearchTerms(snapshot.genreFamilies);
  const themeTerms = genreFamilyThemeTerms(snapshot.genreFamilies);

  // Genre vocabulary from Amazon's own placement and the external catalogues,
  // plus the curated search phrasing for the families it lands in.
  const genreMetadataCandidates = mergeKeywordCandidates(
    buildGenreMetadataCandidates({
      title: snapshot.title,
      author: snapshot.author,
      categories: snapshot.googleBooksCategories,
      subjects: snapshot.openLibrarySubjects,
      commonTerms: snapshot.commonTerms,
    }),
    buildGenreFamilyCandidates(snapshot.genreTerms, familySearchTerms)
  );

  const bookContentCandidates = mergeKeywordCandidates(
    buildBookContentCandidates(snapshot.commonTerms),
    buildDescriptionMetadataCandidates(snapshot.description, snapshot.bulletPoints, themeTerms)
  );

  const descriptionCandidates = [
    ...buildDescriptionCandidates(snapshot.description, snapshot.bulletPoints),
    ...buildDescriptionPhraseCandidates(snapshot.description),
  ];

  const reviewText = [...snapshot.reviewSnippets, ...snapshot.compReviewSnippets, ...snapshot.reviewBodies];
  const reviewLanguageCandidates = mergeKeywordCandidates(
    mineReviewLanguage(reviewText),
    buildReviewGenreIndicators(reviewText, themeTerms)
  );

  // Seed terms for buyer-intent templating: the book's real genre vocabulary,
  // never a guessed one, and only the best-attested end of it. Every term here
  // is multiplied across a dozen templates, so a weak one (a stray Open
  // Library subject like "man-woman relationships") becomes a dozen weak
  // keywords. deriveGenreTerms already orders by source trust.
  const genreSeedTerms = [
    ...snapshot.genreTerms.slice(0, 8),
    ...knownTags,
    ...familySearchTerms.slice(0, 4),
  ].filter(Boolean);

  const categorized = buildCategorizedKeywordCandidates({
    title: snapshot.title ?? "",
    author: snapshot.author ?? "",
    seriesName: snapshot.seriesName,
    genreTerms: genreSeedTerms,
    categoryPath: snapshot.categoryPath,
    competitors: snapshot.competitors,
    compTitles: snapshot.compTitles,
    description: snapshot.description,
    bulletPoints: snapshot.bulletPoints,
    keyTropes,
    goodreadsTags: snapshot.goodreadsTags,
    reviewLanguagePhrases: reviewLanguageCandidates.map((c) => c.text),
    enabledCategories: new Set(keywordCategories),
  });

  return {
    genreSeedTerms,
    categorized,
    groups: {
      "comp-title": buildCompTitleCandidates({
        compTitles: snapshot.compTitles,
        categories: snapshot.categories,
      }),
      "comp-name": buildCompNameCandidates(snapshot.competitors),
      "author-catalog": buildAuthorCatalogCandidates(snapshot.authorCatalogTitles),
      "amazon-recs": buildAmazonRecommendationCandidates([
        snapshot.frequentlyBoughtTogether,
        snapshot.compareWithSimilar,
      ]),
      "genre-metadata": genreMetadataCandidates,
      "book-content": bookContentCandidates,
      "book-description": descriptionCandidates,
      "review-language": reviewLanguageCandidates,
      "customer-qna": buildQnaCandidates(snapshot.qnaQuestions),
      wikipedia: buildWikipediaCandidates(snapshot.wikipediaCategories),
      wikidata: buildWikidataCandidates(snapshot.wikidataGenres),
      "loc-subjects": buildLocCandidates(snapshot.locSubjects),
      "goodreads-tags": buildGoodreadsTagCandidates(snapshot.goodreadsTags),
      firecrawl: buildFirecrawlCandidates(snapshot.firecrawlMetadata),
      "user-tag": buildKnownTagCandidates(knownTags),
      "buyer-intent": buildBuyerIntentCandidates(genreSeedTerms, {
        title: snapshot.title,
        author: snapshot.author,
        seriesName: snapshot.seriesName,
      }),
    },
  };
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

/**
 * POST /api/books/[id]/keywords/generate
 * Body: { keyTropes?: string[], knownTags?: string[], keywordCategories?: KeywordCategory[], sources?: KeywordSource[], defaultBid?: number }
 *
 * Runs the book's stored metadata snapshot through every keyword source and
 * writes the result into the book's keyword list. The snapshot is captured
 * when the book is added (lib/bookSnapshot.ts) and re-captured here only if
 * it's missing or stale, so generation is fast and produces the same keywords
 * the book page says it's working from.
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
    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);

    if (!loaded) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    const { snapshot } = loaded;

    // Without a title there is no book to research: every source would be
    // seeded with nothing and the run would return noise. Say so instead.
    if (!snapshot.capture.ok || !snapshot.title) {
      return Response.json(
        {
          error:
            "This book's Amazon metadata could not be read, so there's nothing to generate keywords from. Re-fetch the metadata and try again.",
          needsRefresh: true,
        },
        { status: 422 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const asStrings = (value: unknown, limit: number): string[] =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).slice(0, limit)
        : [];

    const keyTropes = asStrings(body.keyTropes, 50);
    const knownTags = asStrings(body.knownTags, 50);
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

    const { groups, categorized, genreSeedTerms } = buildSnapshotCandidates(
      snapshot,
      keyTropes,
      knownTags,
      keywordCategories
    );

    // Live sources: autocomplete engines are JSON endpoints that aren't
    // subject to Amazon's product-page bot wall, and Datamuse/Ads API are
    // proper APIs — cheap enough to re-run on every generate.
    const seedTerms = [
      ...buildAutocompleteSeeds({
        title: snapshot.title,
        author: snapshot.author,
        genreTerms: snapshot.genreTerms,
        seriesName: snapshot.seriesName,
      }),
      ...snapshot.firecrawlSeeds,
    ];

    const [
      adsApiCandidates,
      amazonAutocomplete,
      googleAutocomplete,
      youtubeAutocomplete,
      duckDuckGoAutocomplete,
      datamuseSynonyms,
    ] = await Promise.all([
      isAdsApiConfigured()
        ? getAdsApiKeywordRecommendations(snapshot.asin, snapshot.marketplace).catch((err: Error) => {
            console.error("[generate] Ads API recommendations failed:", err.message);
            return [] as KeywordCandidate[];
          })
        : Promise.resolve([] as KeywordCandidate[]),
      getAutocompleteKeywordSet(seedTerms, snapshot.marketplace),
      getGoogleAutocompleteKeywordSet(seedTerms),
      getYoutubeAutocompleteKeywordSet(seedTerms),
      getDuckDuckGoAutocompleteKeywordSet(seedTerms),
      getSynonymExpansionCandidates(genreSeedTerms),
    ]);

    // Autocomplete corpora occasionally return bare ASINs; those belong to
    // product targeting, not the keyword list.
    const liveGroups: Partial<Record<KeywordSource, KeywordCandidate[]>> = {
      "ads-api": extractAsinCandidates(adsApiCandidates).keywords,
      autocomplete: extractAsinCandidates(amazonAutocomplete).keywords,
      "google-autocomplete": extractAsinCandidates(googleAutocomplete).keywords,
      "youtube-autocomplete": extractAsinCandidates(youtubeAutocomplete).keywords,
      "duckduckgo-autocomplete": extractAsinCandidates(duckDuckGoAutocomplete).keywords,
      synonym: [...datamuseSynonyms, ...buildCuratedSynonymCandidates(genreSeedTerms)],
    };

    const sourceCandidateGroups = { ...groups, ...liveGroups };
    const contributingSources = ALL_KEYWORD_SOURCES.filter(
      (source) => enabledSources.has(source) && (sourceCandidateGroups[source]?.length ?? 0) > 0
    );

    const merged = mergeKeywordCandidates(
      ...ALL_KEYWORD_SOURCES.filter((s) => enabledSources.has(s)).map((s) => sourceCandidateGroups[s] ?? []),
      categorized.filter((c) => c.sources.some((source) => enabledSources.has(source)))
    );

    const { tropes, compNames } = splitKeywordsByCategory(collapseNearDuplicates(merged));

    let tropesKeywords = boostScoresByDescriptionQuality(
      scoreAndTierBids(tropes, defaultBid, knownTags),
      { description: snapshot.description, bulletPoints: snapshot.bulletPoints },
      "book-description"
    ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    let compNameKeywords = boostScoresByCompetitorQuality(
      scoreAndTierBids(compNames, defaultBid, knownTags),
      snapshot.competitors,
      0.2
    ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    tropesKeywords = validateFinalKeywords(tropesKeywords, defaultBid).slice(0, BOOK_KEYWORD_MAX);

    // When the crawl only found a comp or two, the "comparable author/title"
    // bucket is mostly names that drifted in from page furniture — imprints,
    // bookshops, unrelated authors with similar names. Drop those rather than
    // bid on them.
    const compDataHealth = assessCompDataHealth(snapshot.competitors);
    compNameKeywords = filterHallucinatedCompKeywords(
      validateFinalKeywords(compNameKeywords, defaultBid),
      compDataHealth
    ).slice(0, BOOK_COMP_NAME_MAX);

    // Optional relevance pass. It reorders and drops off-topic candidates but
    // never truncates the list — an AI that only mentions half the keywords
    // shouldn't cost the user the other half.
    let aiRanked = false;
    if (isAiRankingConfigured()) {
      const ranked = await rankKeywordsWithAi(
        {
          title: snapshot.title,
          author: snapshot.author ?? "",
          seriesName: snapshot.seriesName,
          genreTerms: genreSeedTerms,
          description: snapshot.description,
          pageMarkdown: snapshot.pageMarkdownExcerpt,
        },
        tropesKeywords,
        compNameKeywords
      );
      if (ranked) {
        aiRanked = true;
        tropesKeywords = applyAiRelevance(tropesKeywords, ranked);
        compNameKeywords = applyAiRelevance(compNameKeywords, ranked);
      }
    }

    const finalCandidates = [...tropesKeywords, ...compNameKeywords];

    if (finalCandidates.length === 0) {
      return Response.json(
        {
          error:
            "No keywords could be generated from this book's metadata. Try re-fetching the metadata, or add a few key tropes to seed the search.",
        },
        { status: 502 }
      );
    }

    const rows = finalCandidates.map((candidate) => ({
      book_id: bookId,
      user_id: user.id,
      text: candidate.text,
      match_type: pickMatchType(candidate),
      category: candidate.category ?? null,
      source: primaryKeywordSource(candidate),
      bid: candidate.suggestedBid ?? defaultBid,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
      .select();

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    const insertedCount = inserted?.length ?? 0;

    return Response.json({
      success: true,
      generatedCount: finalCandidates.length,
      insertedCount,
      alreadyPresentCount: finalCandidates.length - insertedCount,
      keywordCount: tropesKeywords.length,
      compNameCount: compNameKeywords.length,
      contributingSources,
      bySource: countBy(rows.map((r) => r.source)),
      byCategory: countBy(rows.map((r) => r.category).filter((c): c is string => !!c)),
      byMatchType: countBy(rows.map((r) => r.match_type)),
      genreTerms: snapshot.genreTerms.slice(0, 10),
      compDataHealth,
      aiRanked,
      metadataCapturedAt: snapshot.capturedAt,
      metadataRefreshed: loaded.captured,
    });
  } catch (err) {
    console.error("Error generating keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
