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
import { getSerpApiKeywordCandidates } from "@/lib/serpApiKeywords";
import { fetchDecodoKeywordRows, isDecodoConfigured } from "@/lib/decodoClient";
import { buildDecodoCandidates } from "@/lib/decodoSource";
import { fetchZenrowsKeywordRows, isZenrowsConfigured } from "@/lib/zenrowsClient";
import { buildZenrowsCandidates } from "@/lib/zenrowsSource";
import { buildPersonaLlmCandidates } from "@/lib/llmPersonaSource";
import { buildGroqPersonaCandidates } from "@/lib/groqKeywordSource";
import { extractAsinCandidates } from "@/lib/keywordMerge";
import { KeywordCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/** Bounds on the live scrapeProductPage metadata pass — a generate run can surface far more ASINs than are worth fetching within the serverless timeout. */
const MAX_METADATA_FETCHES = 40;
const METADATA_CONCURRENCY = 5;
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

    // 2. Live sources
    const seedTerms = [
      ...buildAutocompleteSeeds({
        title: snapshot.title ?? "",
        author: snapshot.author,
        genreTerms: snapshot.genreTerms ?? [],
        seriesName: snapshot.seriesName,
      }),
      ...(snapshot.firecrawlSeeds ?? []),
    ];

    const serpApiSeeds = [...(snapshot.genreTerms ?? []).slice(0, 3), ...(snapshot.seriesName ? [snapshot.seriesName] : [])];

    const [
      adsApiCandidates,
      amazonAutocomplete,
      googleAutocomplete,
      youtubeAutocomplete,
      duckDuckGoAutocomplete,
      serpApiResult,
      personaLlmCandidates,
      groqPersonaCandidates,
      liveDecodoRows,
      liveZenrowsRows,
    ] = await Promise.all([
      isAdsApiConfigured()
        ? getAdsApiKeywordRecommendations(snapshot.asin ?? "", snapshot.marketplace).catch((err: Error) => {
            console.error("[generate] Ads API recommendations failed:", err.message);
            return [] as KeywordCandidate[];
          })
        : Promise.resolve([] as KeywordCandidate[]),
      getAutocompleteKeywordSet(seedTerms, snapshot.marketplace),
      getGoogleAutocompleteKeywordSet(seedTerms),
      getYoutubeAutocompleteKeywordSet(seedTerms),
      getDuckDuckGoAutocompleteKeywordSet(seedTerms),
      getSerpApiKeywordCandidates(serpApiSeeds, snapshot.marketplace),
      buildPersonaLlmCandidates({ title: snapshot.title, author: snapshot.author, asin: snapshot.asin }).catch(
        (err: Error) => {
          console.error("[generate] persona-llm generation failed:", err.message);
          return [] as KeywordCandidate[];
        }
      ),
      // Groq persona: generates search queries, which may surface ASINs.
      buildGroqPersonaCandidates({ title: snapshot.title, author: snapshot.author, asin: snapshot.asin }).catch(
        (err: Error) => {
          console.error("[generate] groq-persona generation failed:", err.message);
          return [] as KeywordCandidate[];
        }
      ),
      isDecodoConfigured()
        ? fetchDecodoKeywordRows(serpApiSeeds, snapshot.marketplace).catch((err: Error) => {
            console.error("[generate] live Decodo fetch failed:", err.message);
            return [];
          })
        : Promise.resolve([]),
      isZenrowsConfigured()
        ? fetchZenrowsKeywordRows(serpApiSeeds, snapshot.marketplace).catch((err: Error) => {
            console.error("[generate] live ZenRows fetch failed:", err.message);
            return [];
          })
        : Promise.resolve([]),
    ]);

    const liveGroups: Record<string, KeywordCandidate[]> = {
      "ads-api": adsApiCandidates,
      "amazon-autocomplete": amazonAutocomplete,
      "google-autocomplete": googleAutocomplete,
      "youtube-autocomplete": youtubeAutocomplete,
      "duckduckgo-autocomplete": duckDuckGoAutocomplete,
      serpapi: serpApiResult.candidates,
      "persona-llm": personaLlmCandidates,
      "groq-persona": groqPersonaCandidates,
      decodo:
        liveDecodoRows.length > 0
          ? buildDecodoCandidates(
              { title: snapshot.title, author: snapshot.author, seriesName: snapshot.seriesName },
              liveDecodoRows
            )
          : [],
      zenrows:
        liveZenrowsRows.length > 0
          ? buildZenrowsCandidates(
              { title: snapshot.title, author: snapshot.author, seriesName: snapshot.seriesName },
              liveZenrowsRows
            )
          : [],
    };

    for (const [source, candidatesList] of Object.entries(liveGroups)) {
      const extracted = extractAsinCandidates(candidatesList);
      extracted.asins.forEach((asin, i) => addCandidate(asin, `Discovered via ${source}`, source, i + 1));
    }

    if (candidates.size === 0) {
      return Response.json({ success: true, candidateCount: totalCrawled, insertedCount: 0 });
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
    const asinsToEnrich = Array.from(selected.keys()).slice(0, MAX_METADATA_FETCHES);
    const metadataByAsin = new Map<string, { title?: string; author?: string; price?: number; bsr?: number }>();
    for (let i = 0; i < asinsToEnrich.length; i += METADATA_CONCURRENCY) {
      const batch = asinsToEnrich.slice(i, i + METADATA_CONCURRENCY);
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
        metadataByAsin.set(asin, {
          title: page.title,
          author: page.author,
          price: page.price,
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

    return Response.json({
      success: true,
      candidateCount: Math.max(candidates.size, totalCrawled),
      insertedCount: data?.length ?? 0,
    });
  } catch (err) {
    console.error("Error generating competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
