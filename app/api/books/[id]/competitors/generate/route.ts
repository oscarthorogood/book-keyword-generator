import { loadBookWithSnapshot } from "@/lib/bookStore";
import { computeCompetitorBid } from "@/lib/competitorBidding";
import { getCompetitorAsins } from "@/lib/competitorStore";
import { isApprovedAuthor } from "@/lib/manualCompetitors";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  getDuckDuckGoAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  getYoutubeAutocompleteKeywordSet,
  scrapeProductPage,
} from "@/lib/scrape";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { buildPersonaLlmCandidates } from "@/lib/llmPersonaSource";
import { buildGroqPersonaCandidates } from "@/lib/groqKeywordSource";
import { generateCompDiscoveryQueries } from "@/lib/llmCompDiscovery";
import { discoverCompetitorAsins, type DiscoveryQuery } from "@/lib/asinDiscovery";
import { extractAsinCandidates } from "@/lib/keywordMerge";
import { KeywordCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** Bounds on the live scrapeProductPage metadata pass — a generate run can surface far more ASINs than are worth fetching within the serverless timeout. */
const MAX_METADATA_FETCHES = 40;
const METADATA_CONCURRENCY = 5;
/** Wall-clock ceiling on the enrichment loop, inside the route's 60s `maxDuration`. */
const METADATA_BUDGET_MS = 20_000;

/**
 * How many queries of each kind seed ASIN discovery. Ordered best-first —
 * lib/asinDiscovery.ts gives each provider's budget to the head of the list —
 * so the deliberate seeds (the book's genre, the LLM's named comps) get
 * searched before the broad autocomplete phrases.
 */
const MAX_GENRE_SEED_QUERIES = 4;
const MAX_PERSONA_QUERIES = 4;
const MAX_AUTOCOMPLETE_QUERIES = 6;
/** Intent segments whose persona queries are worth a competitor search — a mood phrase rarely ranks competing books. */
const COMPETITIVE_SEGMENTS = new Set(["comp-author", "comp-title", "genre-core"]);
/**
 * Default cap on how many competitor ASINs one Generate run inserts, when the
 * caller doesn't request a specific cap. Matches MAX_METADATA_FETCHES so, by
 * default, every inserted row gets a live metadata fetch rather than landing
 * with null title/author/price/bsr.
 */
const DEFAULT_COMPETITOR_CAP = 40;
/** Ceiling on the user-facing cap — a book's competitor set is meant to stay a shortlist, not the entire discovery pool. */
const MAX_COMPETITOR_CAP = 200;

/**
 * POST /api/books/[id]/competitors/generate
 * Body: { resultCap?: number }
 *
 * Pulls competitor ASINs from the stored snapshot plus all live API sources
 * (Ads API, autocomplete engines, SerpApi, Persona-LLM, Groq-Persona, Decodo)
 * mirroring the keyword generate pipeline. ASINs already tracked are skipped.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const requestedCap =
      typeof body.resultCap === "number" && Number.isFinite(body.resultCap) && body.resultCap > 0
        ? Math.floor(body.resultCap)
        : DEFAULT_COMPETITOR_CAP;
    const competitorCap = Math.min(requestedCap, MAX_COMPETITOR_CAP);

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });

    const { snapshot, book } = loaded;
    if (!snapshot.capture?.ok) {
      return Response.json(
        {
          error: "This book's Amazon metadata could not be read, so there's no competitor crawl to draw from. Re-fetch the metadata and try again.",
          needsRefresh: true,
        },
        { status: 422 }
      );
    }

    const existing = await getCompetitorAsins(supabase, bookId, user.id);
    const existingAsins = new Set(existing.map((row) => row.competitor_asin.toUpperCase()));
    const ownAsin = (snapshot.asin ?? book.asin ?? "").toUpperCase();

    // `positions` records the 1-based index this ASIN was found at within
    // each discovery list it appeared in — used below to compute
    // competitor_count (distinct source agreement) and mean_rank (average
    // position) per sql/17-competitor-asin-metadata.sql, the same shape as
    // aggregateReverseAsinRows' competitorCount/meanRank in lib/reverseAsin.ts.
    const candidates = new Map<string, { notes: string | null; source: string; positions: number[] }>();

    const addCandidate = (asinRaw: string | undefined, notes: string | null, source: string, position: number) => {
      const asin = asinRaw?.toUpperCase();
      if (!asin || !ASIN_PATTERN.test(asin) || asin === ownAsin || existingAsins.has(asin)) return;
      const entry = candidates.get(asin);
      if (entry) {
        entry.positions.push(position);
      } else {
        candidates.set(asin, { notes, source, positions: [position] });
      }
    };

    // 1. Snapshot sources
    (snapshot.competitors ?? []).forEach((competitor, i) => {
      const notes = [competitor.title, competitor.author].filter(Boolean).join(" — ") || null;
      addCandidate(competitor.asin, notes, "auto-crawl", i + 1);
    });
    (snapshot.compAsins ?? []).forEach((asinRaw, i) => {
      addCandidate(asinRaw, "Related listing", "auto-crawl", i + 1);
    });
    (snapshot.frequentlyBoughtTogether ?? []).forEach((item, i) => {
      addCandidate(item.asin, item.title ? `Frequently bought together — ${item.title}` : "Frequently bought together", "auto-crawl", i + 1);
    });
    (snapshot.compareWithSimilar ?? []).forEach((item, i) => {
      addCandidate(item.asin, item.title ? `Similar title — ${item.title}` : "Similar title", "auto-crawl", i + 1);
    });

    const totalCrawled = candidates.size;

    // 2. Live discovery.
    //
    // Autocomplete engines and the persona LLMs return *search phrases*, not
    // ASINs — running them through extractAsinCandidates (as this route used
    // to) matched nothing, so every one of them contributed zero competitors.
    // They're used for what they actually produce: queries. Those queries,
    // plus the book's genre seeds and a set of comp-finding queries from
    // OpenRouter, go to the providers that can answer "which books rank for
    // this?" (lib/asinDiscovery.ts).
    const autocompleteSeeds = [
      ...buildAutocompleteSeeds({
        title: snapshot.title ?? "",
        author: snapshot.author,
        genreTerms: snapshot.genreTerms ?? [],
        seriesName: snapshot.seriesName,
      }),
      ...(snapshot.firecrawlSeeds ?? []),
    ];

    const genreSeeds = [
      ...(snapshot.genreTerms ?? []).slice(0, 3),
      ...(snapshot.seriesName ? [snapshot.seriesName] : []),
    ];

    const personaContext = {
      title: snapshot.title,
      author: snapshot.author,
      asin: snapshot.asin,
      seriesName: snapshot.seriesName,
      genreTerms: snapshot.genreTerms ?? [],
      categories: snapshot.categories ?? [],
      description: snapshot.description,
      compTitles: (snapshot.compTitles ?? []).slice(0, 8),
      compAuthors: (snapshot.competitors ?? [])
        .map((competitor) => competitor.author)
        .filter((author): author is string => !!author)
        .slice(0, 8),
      marketplace: snapshot.marketplace,
    };

    const [
      adsApiCandidates,
      amazonAutocomplete,
      googleAutocomplete,
      youtubeAutocomplete,
      duckDuckGoAutocomplete,
      personaLlmCandidates,
      groqPersonaCandidates,
      compDiscovery,
    ] = await Promise.all([
      isAdsApiConfigured()
        ? getAdsApiKeywordRecommendations(snapshot.asin ?? "", snapshot.marketplace).catch((err: Error) => {
            console.error("[generate] Ads API recommendations failed:", err.message);
            return [] as KeywordCandidate[];
          })
        : Promise.resolve([] as KeywordCandidate[]),
      getAutocompleteKeywordSet(autocompleteSeeds, snapshot.marketplace),
      getGoogleAutocompleteKeywordSet(autocompleteSeeds),
      getYoutubeAutocompleteKeywordSet(autocompleteSeeds),
      getDuckDuckGoAutocompleteKeywordSet(autocompleteSeeds),
      buildPersonaLlmCandidates(personaContext).catch((err: Error) => {
        console.error("[generate] persona-llm generation failed:", err.message);
        return [] as KeywordCandidate[];
      }),
      buildGroqPersonaCandidates(personaContext).catch((err: Error) => {
        console.error("[generate] groq-persona generation failed:", err.message);
        return [] as KeywordCandidate[];
      }),
      generateCompDiscoveryQueries(personaContext).catch((err: Error) => {
        console.error("[generate] comp-discovery generation failed:", err.message);
        return { queries: [], compAuthors: [], compTitles: [] };
      }),
    ]);

    // The Ads API is the one live source that can name an ASIN directly.
    const adsApiAsins = extractAsinCandidates(adsApiCandidates).asins;
    adsApiAsins.forEach((asin, i) => addCandidate(asin, "Discovered via ads-api", "ads-api", i + 1));

    /** Persona queries worth a competitor search: comp/genre intents, not mood phrases. */
    const personaQueries = (candidatesList: KeywordCandidate[], origin: string): DiscoveryQuery[] =>
      candidatesList
        .filter((candidate) => !candidate.intentSegment || COMPETITIVE_SEGMENTS.has(candidate.intentSegment))
        .slice(0, MAX_PERSONA_QUERIES)
        .map((candidate) => ({ query: candidate.text, origin }));

    const discoveryQueries: DiscoveryQuery[] = [
      // Genre/series seeds first: the proven baseline this route already used.
      ...genreSeeds.slice(0, MAX_GENRE_SEED_QUERIES).map((query) => ({ query, origin: "genre-seed" })),
      // Then the LLM's comp-finding queries and the names it identified — the
      // most targeted competitor queries available.
      ...compDiscovery.queries.map((query) => ({ query, origin: "comp-discovery" })),
      ...compDiscovery.compAuthors.map((query) => ({ query, origin: "comp-discovery" })),
      ...compDiscovery.compTitles.map((query) => ({ query, origin: "comp-discovery" })),
      ...personaQueries(personaLlmCandidates, "persona-llm"),
      ...personaQueries(groqPersonaCandidates, "groq-persona"),
      // Autocomplete phrases last: broad, and there are a lot of them.
      ...amazonAutocomplete.slice(0, MAX_AUTOCOMPLETE_QUERIES).map((c) => ({ query: c.text, origin: "amazon-autocomplete" })),
      ...googleAutocomplete.slice(0, MAX_AUTOCOMPLETE_QUERIES).map((c) => ({ query: c.text, origin: "google-autocomplete" })),
      ...youtubeAutocomplete.slice(0, MAX_AUTOCOMPLETE_QUERIES).map((c) => ({ query: c.text, origin: "youtube-autocomplete" })),
      ...duckDuckGoAutocomplete
        .slice(0, MAX_AUTOCOMPLETE_QUERIES)
        .map((c) => ({ query: c.text, origin: "duckduckgo-autocomplete" })),
    ];

    const discovery = await discoverCompetitorAsins(discoveryQueries, snapshot.marketplace);

    // Metadata the providers returned alongside each ASIN — saves a
    // product-page fetch per row further down.
    const discoveredMetadata = new Map<string, { title?: string; author?: string; price?: number }>();
    for (const found of discovery.discovered) {
      // Title/author first, then provenance in a trailing "Discovered via …"
      // segment: the keyword pipeline mines these notes for comparable names
      // by splitting on " — " and skipping that segment, so the query text
      // never leaks in as a keyword.
      const notes = [
        ...[found.title, found.author].filter(Boolean),
        `Discovered via ${found.provider} (${found.origin}: "${found.query}")`,
      ].join(" — ");
      addCandidate(found.asin, notes, found.provider, found.position);

      const asin = found.asin.toUpperCase();
      const existingMeta = discoveredMetadata.get(asin);
      if (found.title || found.author || found.price !== undefined) {
        discoveredMetadata.set(asin, {
          title: existingMeta?.title ?? found.title,
          author: existingMeta?.author ?? found.author,
          price: existingMeta?.price ?? found.price,
        });
      }
    }

    if (candidates.size === 0) {
      return Response.json({
        success: true,
        candidateCount: totalCrawled,
        insertedCount: 0,
        discovery: {
          queryCount: discoveryQueries.length,
          providersUsed: discovery.providersUsed,
          callsByProvider: discovery.callsByProvider,
        },
      });
    }

    // Apply the user-facing cap before enrichment/insertion, keeping the
    // best-ranked candidates (lowest mean discovery position) rather than an
    // arbitrary prefix — the cap should keep the strongest matches, not just
    // whichever source happened to run first.
    const selected = new Map(
      Array.from(candidates.entries())
        .sort(([, a], [, b]) => {
          const meanA = a.positions.reduce((sum, p) => sum + p, 0) / a.positions.length;
          const meanB = b.positions.reduce((sum, p) => sum + p, 0) / b.positions.length;
          return meanA - meanB;
        })
        .slice(0, competitorCap)
    );

    // 3. Minimal metadata (spec task 1) — reuse scrapeProductPage (lib/scrape.ts),
    // same source the comp-crawl itself uses, rather than a new fetcher.
    // Best-effort and bounded: a book can surface far more candidates than
    // are worth a live product-page fetch per Generate run.
    //
    // Discovery already returned title/author/price for many ASINs, so the
    // fetch budget goes to the ones nothing is known about first; anything
    // that isn't fetched (or whose fetch fails) still lands with whatever the
    // discovery provider gave us instead of a row of nulls.
    const selectedAsins = Array.from(selected.keys());
    const asinsToEnrich = [
      ...selectedAsins.filter((asin) => !discoveredMetadata.get(asin)?.title || !discoveredMetadata.get(asin)?.author),
      ...selectedAsins.filter((asin) => discoveredMetadata.get(asin)?.title && discoveredMetadata.get(asin)?.author),
    ].slice(0, MAX_METADATA_FETCHES);

    const metadataByAsin = new Map<string, { title?: string; author?: string; price?: number; bsr?: number }>(
      Array.from(discoveredMetadata.entries()).map(([asin, meta]) => [asin, { ...meta }])
    );
    // Discovery costs wall clock the old snapshot-only path didn't, so the
    // enrichment loop stops at a deadline rather than assuming 40 sequential
    // batches will fit. Whatever is left keeps its discovery metadata.
    const metadataDeadline = Date.now() + METADATA_BUDGET_MS;
    let metadataFetched = 0;
    for (let i = 0; i < asinsToEnrich.length; i += METADATA_CONCURRENCY) {
      if (Date.now() >= metadataDeadline) {
        console.warn(
          `[generate] metadata budget reached after ${metadataFetched}/${asinsToEnrich.length} ASINs — the rest keep their discovery metadata`
        );
        break;
      }
      const batch = asinsToEnrich.slice(i, i + METADATA_CONCURRENCY);
      metadataFetched += batch.length;
      const pages = await Promise.all(
        batch.map((asin) =>
          scrapeProductPage(asin, snapshot.marketplace).catch((err: Error) => {
            console.error(`[generate] metadata fetch failed for ${asin}:`, err.message);
            return null;
          })
        )
      );
      batch.forEach((asin, j) => {
        const page = pages[j];
        if (!page) return;
        const discovered = metadataByAsin.get(asin);
        // The live page wins where it has a value; discovery fills the gaps.
        metadataByAsin.set(asin, {
          title: page.title ?? discovered?.title,
          author: page.author ?? discovered?.author,
          price: page.price ?? discovered?.price,
          bsr: page.bestSellerRanks?.[0]?.rank,
        });
      });
    }

    // Drop candidates whose fetched author is (a) the book's own author —
    // e.g. a box set/omnibus edition of the seed book isn't a competitor —
    // or (b) an already-tracked author for this book: isApprovedAuthor()
    // recognizes the book's own name and this book's approved comp-author
    // list (lib/manualCompetitors.ts), so once one ASIN from a given
    // approved author is tracked, later Generate runs skip piling on more
    // ASINs from that same author.
    const bookAuthor = snapshot.author ?? "";
    const existingAuthors = new Set(
      existing.map((row) => row.author?.trim().toLowerCase()).filter((a): a is string => Boolean(a))
    );
    const rows = Array.from(selected.entries())
      .filter(([asin]) => {
        const meta = metadataByAsin.get(asin);
        if (!meta?.author) return true;
        const normalizedAuthor = meta.author.trim().toLowerCase();
        if (bookAuthor && normalizedAuthor === bookAuthor.trim().toLowerCase()) return false;
        if (isApprovedAuthor(meta.author, bookAuthor, ownAsin) && existingAuthors.has(normalizedAuthor)) return false;
        return true;
      })
      .map(([asin, data]) => {
        const meta = metadataByAsin.get(asin);
        const meanRankRaw = data.positions.reduce((sum, p) => sum + p, 0) / data.positions.length;
        const meanRank = Number.isFinite(meanRankRaw) ? meanRankRaw : null;
        return {
          book_id: bookId,
          user_id: user.id,
          competitor_asin: asin,
          source: data.source,
          notes: data.notes,
          title: meta?.title ?? null,
          author: meta?.author ?? null,
          price: meta?.price ?? null,
          bsr: meta?.bsr ?? null,
          competitor_count: data.positions.length,
          mean_rank: meanRank,
          bid: computeCompetitorBid({
            price: meta?.price ?? null,
            bsr: meta?.bsr ?? null,
            competitorCount: data.positions.length,
            meanRank,
          }),
        };
      });

    const { data, error } = await supabase
      .from("competitor_asins")
      .upsert(rows, { onConflict: "book_id,competitor_asin", ignoreDuplicates: true })
      .select("id");

    if (error) return Response.json({ error: error.message }, { status: 400 });

    const countBy = (values: string[]): Record<string, number> => {
      const counts: Record<string, number> = {};
      for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
      return counts;
    };

    return Response.json({
      success: true,
      candidateCount: Math.max(candidates.size, totalCrawled),
      insertedCount: data?.length ?? 0,
      crawledCount: totalCrawled,
      bySource: countBy(rows.map((row) => row.source)),
      discovery: {
        queryCount: discoveryQueries.length,
        /** Which seed source suggested the queries that were run. */
        byQueryOrigin: countBy(discoveryQueries.map((entry) => entry.origin)),
        providersUsed: discovery.providersUsed,
        callsByProvider: discovery.callsByProvider,
        compAuthorsNamed: compDiscovery.compAuthors.length,
        compTitlesNamed: compDiscovery.compTitles.length,
      },
      metadataFetched,
      metadataFromDiscovery: discoveredMetadata.size,
    });
  } catch (err) {
    console.error("Error generating competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
