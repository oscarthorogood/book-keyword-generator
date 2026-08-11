import { loadBookWithSnapshot } from "@/lib/bookStore";
import { getCompetitorAsins } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  getDuckDuckGoAutocompleteKeywordSet,
  getGoogleAutocompleteKeywordSet,
  getYoutubeAutocompleteKeywordSet,
} from "@/lib/scrape";
import { getAdsApiKeywordRecommendations, isAdsApiConfigured } from "@/lib/amazonAds";
import { getSerpApiKeywordCandidates } from "@/lib/serpApiKeywords";
import { fetchDecodoKeywordRows, isDecodoConfigured } from "@/lib/decodoClient";
import { buildPersonaLlmCandidates } from "@/lib/llmPersonaSource";
import { buildGroqPersonaCandidates } from "@/lib/groqKeywordSource";
import { extractAsinCandidates } from "@/lib/keywordMerge";
import { KeywordCandidate } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/**
 * POST /api/books/[id]/competitors/generate
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

    const candidates = new Map<string, { notes: string | null; source: string }>();

    const addCandidate = (asinRaw: string | undefined, notes: string | null, source: string) => {
      const asin = asinRaw?.toUpperCase();
      if (!asin || !ASIN_PATTERN.test(asin) || asin === ownAsin || existingAsins.has(asin) || candidates.has(asin)) return;
      candidates.set(asin, { notes, source });
    };

    // 1. Snapshot sources
    for (const competitor of snapshot.competitors ?? []) {
      const notes = [competitor.title, competitor.author].filter(Boolean).join(" — ") || null;
      addCandidate(competitor.asin, notes, "auto-crawl");
    }
    for (const asinRaw of snapshot.compAsins ?? []) {
      addCandidate(asinRaw, "Related listing", "auto-crawl");
    }
    for (const item of snapshot.frequentlyBoughtTogether ?? []) {
      addCandidate(item.asin, item.title ? `Frequently bought together — ${item.title}` : "Frequently bought together", "auto-crawl");
    }
    for (const item of snapshot.compareWithSimilar ?? []) {
      addCandidate(item.asin, item.title ? `Similar title — ${item.title}` : "Similar title", "auto-crawl");
    }

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
    };

    for (const [source, candidatesList] of Object.entries(liveGroups)) {
      const extracted = extractAsinCandidates(candidatesList);
      for (const asin of extracted.asins) {
        addCandidate(asin, `Discovered via ${source}`, source);
      }
    }

    if (candidates.size === 0) {
      return Response.json({ success: true, candidateCount: totalCrawled, insertedCount: 0 });
    }

    const rows = Array.from(candidates.entries()).map(([asin, data]) => ({
      book_id: bookId,
      user_id: user.id,
      competitor_asin: asin,
      source: data.source,
      notes: data.notes,
    }));

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
