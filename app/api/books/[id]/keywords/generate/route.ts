import { applyAiRelevance, isAiRankingConfigured, rankKeywordsWithAi } from "@/lib/aiRanker";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { listingRecordFromSnapshot, type BookSnapshot } from "@/lib/bookSnapshot";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { assessCompDataHealth, filterHallucinatedCompKeywords } from "@/lib/compDataValidation";
import { boostScoresByDescriptionQuality } from "@/lib/descriptionQuality";
import { genreFamilySearchTerms, genreFamilyThemeTerms } from "@/lib/genre";
import { buildGoodreadsTagCandidates } from "@/lib/goodreads";
import { ALL_KEYWORD_CATEGORIES, buildCategorizedKeywordCandidates } from "@/lib/keywordCategories";
import { applyFiltersToCandidates, buildFilterContext } from "@/lib/keywordFilters";
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
import { scoreSpecificity } from "@/lib/keywordSpecificity";
import { findAllowlistOverrides } from "@/lib/filterAllowlist";
import { buildListingMetadataCandidates } from "@/lib/listingKeywords";
import { buildFormatNegatives, buildNegativeKeywords } from "@/lib/negativeKeywords";
import { buildBrandTargets, buildProductTargets } from "@/lib/productTargets";
import { mineReviewLanguage } from "@/lib/reviewMining";
import { getSerpApiKeywordCandidates } from "@/lib/serpApiKeywords";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  getDuckDuckGoAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  getYoutubeAutocompleteKeywordSet,
} from "@/lib/scrape";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { KeywordCandidate, KeywordCategory, KeywordSource, MatchType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// How many keywords per bucket the AI relevance pass judges. Its whole design
// is a small, fast call over a pre-filtered shortlist (see lib/aiRanker.ts) —
// handing it the full research list makes one slow call that comes back
// partial regardless.
const AI_REVIEW_LIMIT = 80;

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
  "listing-metadata",
  "serpapi-related",
  "serpapi-organic",
  "serpapi-autocomplete",
  "user-tag",
  "key-trope",
];

/** Candidate groups built purely from the stored snapshot — no network calls. */
function buildSnapshotCandidates(
  snapshot: BookSnapshot,
  keyTropes: string[],
  knownTags: string[],
  keywordCategories: KeywordCategory[],
  primaryGenrePhrase: string
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
    primaryGenrePhrase,
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
      // The listing's own HTML metadata: Amazon's meta keywords, the page
      // title, the canonical URL slug and the variation swatches, plus the
      // best field-weighted n-grams across all of it (lib/listingKeywords.ts).
      "listing-metadata": buildListingMetadataCandidates(listingRecordFromSnapshot(snapshot)),
      "buyer-intent": buildBuyerIntentCandidates(genreSeedTerms, {
        title: snapshot.title,
        author: snapshot.author,
        seriesName: snapshot.seriesName,
        formats: snapshot.formats ?? [],
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

    // The relevance anchors for this book — title/author/series/characters,
    // genre, setting, comparable authors — derived from the stored snapshot.
    // They drive the filter pipeline's final gate and the completion of
    // dangling modifiers during generation.
    const filterContext = buildFilterContext({
      title: snapshot.title,
      author: snapshot.author,
      seriesName: snapshot.seriesName,
      description: snapshot.description,
      genreTerms: snapshot.genreTerms,
      genreFamilies: snapshot.genreFamilies,
      categoryPath: snapshot.categoryPath,
      categories: snapshot.categories,
      goodreadsTags: snapshot.goodreadsTags,
      competitors: snapshot.competitors,
      compTitles: snapshot.compTitles,
      reviewSnippets: snapshot.reviewSnippets,
      keyTropes,
      marketplace: snapshot.marketplace,
      language: snapshot.language,
      formats: snapshot.formats ?? [],
      isKindleUnlimited: !!snapshot.isKindleUnlimited,
    });

    const { groups, categorized, genreSeedTerms } = buildSnapshotCandidates(
      snapshot,
      keyTropes,
      knownTags,
      keywordCategories,
      filterContext.anchors.primaryGenrePhrase
    );

    // Live sources: autocomplete engines are JSON endpoints that aren't
    // subject to Amazon's product-page bot wall, and SerpApi/the Ads API are
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

    // SerpApi is seeded with genre/comp phrases rather than the title: a
    // title search returns the book itself, a subgenre search returns the
    // shelf it competes on — and Amazon's own "related searches" for that
    // shelf are the highest-value expansions available.
    const serpApiSeeds = [...genreSeedTerms.slice(0, 3), ...(snapshot.seriesName ? [snapshot.seriesName] : [])];

    const [
      adsApiCandidates,
      amazonAutocomplete,
      googleAutocomplete,
      youtubeAutocomplete,
      duckDuckGoAutocomplete,
      serpApiResult,
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
      getSerpApiKeywordCandidates(serpApiSeeds, snapshot.marketplace),
    ]);

    const serpApiBySource = (source: KeywordSource) =>
      serpApiResult.candidates.filter((candidate) => candidate.sources.includes(source));

    // Autocomplete corpora occasionally return bare ASINs; those belong to
    // product targeting, not the keyword list.
    const liveGroups: Partial<Record<KeywordSource, KeywordCandidate[]>> = {
      "ads-api": extractAsinCandidates(adsApiCandidates).keywords,
      autocomplete: extractAsinCandidates(amazonAutocomplete).keywords,
      "google-autocomplete": extractAsinCandidates(googleAutocomplete).keywords,
      "youtube-autocomplete": extractAsinCandidates(youtubeAutocomplete).keywords,
      "duckduckgo-autocomplete": extractAsinCandidates(duckDuckGoAutocomplete).keywords,
      "serpapi-related": serpApiBySource("serpapi-related"),
      "serpapi-organic": serpApiBySource("serpapi-organic"),
      "serpapi-autocomplete": serpApiBySource("serpapi-autocomplete"),
      // Synonym expansion is allowlist-only (lib/synonyms.ts): genre phrases
      // map to other genre phrases, or they don't expand. The open-ended
      // thesaurus lookup this replaced is what produced "felon books".
      synonym: buildCuratedSynonymCandidates(genreSeedTerms),
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

    // Carries the filter pipeline's match-type ceiling alongside the candidate,
    // so a blurb-mined phrase can be capped at Phrase when it lands in a row.
    type ReviewedKeyword = KeywordCandidate & { matchTypeCeiling?: MatchType };

    let tropesKeywords: ReviewedKeyword[] = boostScoresByDescriptionQuality(
      scoreAndTierBids(tropes, defaultBid, knownTags),
      { description: snapshot.description, bulletPoints: snapshot.bulletPoints },
      "book-description"
    ).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    let compNameKeywords: ReviewedKeyword[] = boostScoresByCompetitorQuality(
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

    // Optional relevance pass over the top of each list. The AI judges a
    // shortlist, not the whole research list: sending hundreds of candidates
    // makes one slow call that returns a partial answer anyway. It reorders
    // and drops off-topic candidates within that slice — everything below it
    // keeps its heuristic position rather than being lost.
    let aiRanked = false;
    if (isAiRankingConfigured()) {
      const tropesHead = tropesKeywords.slice(0, AI_REVIEW_LIMIT);
      const tropesTail = tropesKeywords.slice(AI_REVIEW_LIMIT);
      const compHead = compNameKeywords.slice(0, AI_REVIEW_LIMIT);
      const compTail = compNameKeywords.slice(AI_REVIEW_LIMIT);

      const ranked = await rankKeywordsWithAi(
        {
          title: snapshot.title,
          author: snapshot.author ?? "",
          seriesName: snapshot.seriesName,
          genreTerms: genreSeedTerms,
          description: snapshot.description,
          pageMarkdown: snapshot.pageMarkdownExcerpt,
        },
        tropesHead,
        compHead
      );
      if (ranked) {
        aiRanked = true;
        tropesKeywords = [...applyAiRelevance(tropesHead, ranked), ...tropesTail];
        compNameKeywords = [...applyAiRelevance(compHead, ranked), ...compTail];
      }
    }

    // ---- Filter pipeline -------------------------------------------------
    // Everything above is source-led: each source contributes what it found.
    // This is the shared validation layer that decides what any of it is
    // worth for *this* book (lib/keywordFilters.ts). Rejections and pauses
    // are kept, with the deciding filter and its reason, so the keyword
    // manager can show why — and a false positive can be resurrected.
    const tropesFiltered = applyFiltersToCandidates(tropesKeywords, filterContext);
    const compFiltered = applyFiltersToCandidates(compNameKeywords, filterContext);

    tropesKeywords = tropesFiltered.passed;
    compNameKeywords = compFiltered.passed;

    const filterSummary = {
      byVerdict: {
        pass: tropesFiltered.summary.byVerdict.pass + compFiltered.summary.byVerdict.pass,
        pause: tropesFiltered.summary.byVerdict.pause + compFiltered.summary.byVerdict.pause,
        reject: tropesFiltered.summary.byVerdict.reject + compFiltered.summary.byVerdict.reject,
      },
      byFilter: { ...tropesFiltered.summary.byFilter } as Record<string, number>,
    };
    for (const [filter, count] of Object.entries(compFiltered.summary.byFilter)) {
      filterSummary.byFilter[filter] = (filterSummary.byFilter[filter] ?? 0) + count;
    }

    const pausedCandidates = [...tropesFiltered.paused, ...compFiltered.paused];
    const rejectedCandidates = [...tropesFiltered.rejected, ...compFiltered.rejected];

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

    // Negatives: the rejections that describe a real (unwanted) search
    // intent, plus the formats this listing doesn't have. Rejecting a
    // keyword stops the app bidding on it; a negative stops Amazon serving
    // on it via a broader match.
    const negatives = [
      ...buildNegativeKeywords([...tropesFiltered.results, ...compFiltered.results]),
      ...buildFormatNegatives(snapshot.formats ?? []),
    ];

    // §21: per-book match-type strategy — "mixed" (default) or
    // "phrase-only" (never Broad, for cleaner search-term comparison data).
    const matchTypeProfile = loaded.book.match_type_profile ?? "mixed";

    const activeRows = finalCandidates.map((candidate) => ({
      book_id: bookId,
      user_id: user.id,
      text: candidate.text,
      // A phrase mined from the book's own blurb is long-tail by nature: it
      // is specific enough for Phrase/Exact and far too thin for Broad.
      match_type:
        candidate.matchTypeCeiling && pickMatchType(candidate, matchTypeProfile) === "broad"
          ? candidate.matchTypeCeiling
          : pickMatchType(candidate, matchTypeProfile),
      category: candidate.category ?? null,
      source: primaryKeywordSource(candidate),
      bid: candidate.suggestedBid ?? defaultBid,
      status: "active",
      rejection_reason: null as string | null,
      rejected_by_filter: null as string | null,
      specificity: scoreSpecificity(candidate, filterContext.anchors),
    }));

    const reviewRowsRaw = [
      ...pausedCandidates.map((candidate) => ({ candidate, status: "paused" as const })),
      ...rejectedCandidates.map((candidate) => ({ candidate, status: "rejected" as const })),
    ].map(({ candidate, status }) => ({
      book_id: bookId,
      user_id: user.id,
      text: candidate.text,
      match_type: pickMatchType(candidate, matchTypeProfile),
      category: candidate.category ?? null,
      source: primaryKeywordSource(candidate),
      bid: candidate.suggestedBid ?? defaultBid,
      status,
      rejection_reason: candidate.reason ?? null,
      rejected_by_filter: candidate.filter ?? null,
      specificity: scoreSpecificity(candidate, filterContext.anchors),
    }));

    // §16 (scoped): a keyword restored to the user's filter allowlist
    // never gets rejected again — checked here, after the pipeline runs,
    // so lib/keywordFilters.ts itself stays DB-free and synchronous.
    const { data: allowlistRows } = await supabase.from("filter_allowlist").select("keyword_text").eq("user_id", user.id);
    const allowlistOverrides = new Set(
      findAllowlistOverrides(reviewRowsRaw, (allowlistRows ?? []).map((r) => r.keyword_text))
    );
    const reviewRows = reviewRowsRaw.map((row) =>
      allowlistOverrides.has(row)
        ? { ...row, status: "active" as const, rejection_reason: null, rejected_by_filter: null }
        : row
    );

    const negativeRows = negatives.map((negative) => ({
      book_id: bookId,
      user_id: user.id,
      text: negative.text,
      match_type: negative.matchType,
      category: null,
      source: "manual" as KeywordSource,
      bid: null,
      status: "negative",
      rejection_reason: negative.reason,
      rejected_by_filter: null as string | null,
      // Negatives aren't bid on, so a Broad-Specific rating doesn't apply.
      specificity: null as number | null,
    }));

    // Negatives are keyed on (book, text, match_type) like everything else,
    // so a term that is both a negative and a rejected keyword would collide
    // on upsert; the negative wins, since it's the one that does something.
    const negativeKeys = new Set(negativeRows.map((row) => `${row.text}|${row.match_type}`));
    const rows = [
      ...activeRows,
      ...reviewRows.filter((row) => !negativeKeys.has(`${row.text}|${row.match_type}`)),
      ...negativeRows,
    ];

    let { data: inserted, error: insertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
      .select();

    // sql/08-keyword-filter-status.sql adds the 'rejected' status and the two
    // reason columns. On a database that hasn't had it applied yet, write the
    // active keywords only rather than failing the whole run, and say why.
    const needsFilterMigration =
      !!insertError && /rejection_reason|rejected_by_filter|status_check|rejected/i.test(insertError.message);

    if (needsFilterMigration) {
      console.error("[generate] filter columns missing — apply sql/08-keyword-filter-status.sql:", insertError!.message);
      const legacyRows = activeRows.map(({ rejection_reason, rejected_by_filter, ...row }) => {
        void rejection_reason;
        void rejected_by_filter;
        return row;
      });
      ({ data: inserted, error: insertError } = await supabase
        .from("keywords")
        .upsert(legacyRows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
        .select());
    }

    // sql/09-keyword-specificity.sql adds the specificity column. On a
    // database that hasn't had it applied yet, drop it and retry rather
    // than failing the whole run.
    const needsSpecificityMigration = !!insertError && /specificity/i.test(insertError.message);

    if (needsSpecificityMigration) {
      console.error("[generate] specificity column missing — apply sql/09-keyword-specificity.sql:", insertError!.message);
      const sourceRows = needsFilterMigration
        ? activeRows.map(({ rejection_reason, rejected_by_filter, ...row }) => {
            void rejection_reason;
            void rejected_by_filter;
            return row;
          })
        : rows;
      const rowsWithoutSpecificity = sourceRows.map(({ specificity, ...row }) => {
        void specificity;
        return row;
      });
      ({ data: inserted, error: insertError } = await supabase
        .from("keywords")
        .upsert(rowsWithoutSpecificity, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
        .select());
    }

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    const insertedCount = inserted?.length ?? 0;

    // Product targeting is a separate campaign type: bare ASINs match no
    // text, and brand targeting reaches a competitor's whole catalogue.
    const productTargets = buildProductTargets(snapshot.competitors, snapshot.compAsins);
    const brandTargets = buildBrandTargets(snapshot.competitors);

    return Response.json({
      success: true,
      generatedCount: finalCandidates.length,
      insertedCount,
      alreadyPresentCount: rows.length - insertedCount,
      keywordCount: tropesKeywords.length,
      compNameCount: compNameKeywords.length,
      pausedCount: pausedCandidates.length,
      rejectedCount: rejectedCandidates.length,
      negativeCount: negatives.length,
      filterSummary,
      contributingSources,
      bySource: countBy(activeRows.map((r) => r.source)),
      byCategory: countBy(
        activeRows.map((r) => r.category).filter((c): c is KeywordCategory => !!c)
      ),
      byMatchType: countBy(activeRows.map((r) => r.match_type)),
      matchTypeProfile,
      allowlistOverrideCount: allowlistOverrides.size,
      genreTerms: snapshot.genreTerms.slice(0, 10),
      anchors: {
        bookSpecific: filterContext.anchors.bookSpecific.slice(0, 10),
        genre: filterContext.anchors.genre.slice(0, 10),
        setting: filterContext.anchors.setting.slice(0, 10),
        comps: filterContext.anchors.comps.slice(0, 10),
        primaryGenrePhrase: filterContext.anchors.primaryGenrePhrase,
      },
      productTargetCount: productTargets.length,
      brandTargetCount: brandTargets.length,
      serpApiCreditsUsed: serpApiResult.creditsUsed,
      // Set when the database predates sql/08-keyword-filter-status.sql, so
      // only the active keywords could be stored.
      needsFilterMigration,
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
