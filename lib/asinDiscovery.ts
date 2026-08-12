/**
 * Competitor-ASIN discovery: search queries in, ranked ASINs out.
 *
 * Competitor generation used to run every live source through
 * `extractAsinCandidates`, which only recognises a candidate whose *text is
 * itself an ASIN*. Autocomplete engines, the persona LLMs, SerpApi's related
 * searches and the Decodo/ZenRows term sweeps all return search phrases, so
 * that check matched nothing and every one of those sources contributed zero
 * ASINs — the entire competitor set came from the snapshot crawl. Worse,
 * SerpApi already returned real ASINs on its `asins`/`organicProducts`
 * fields and the route dropped them on the floor.
 *
 * This module is the missing half. It takes queries (genre seeds, LLM-named
 * comps, autocomplete phrases — see lib/llmCompDiscovery.ts) and asks the
 * three providers that can actually answer "which books rank for this?":
 *
 *   SerpApi  structured Amazon search results (1 credit per query)
 *   ZenRows  real Amazon search HTML through a proxy pool, parsed locally
 *   Decodo   parsed SERP JSON
 *
 * Each is bounded by its own credit budget, each degrades to nothing on
 * failure, and results carry the provider, the query that found them and the
 * rank they appeared at, so the caller can score by source agreement and mean
 * position exactly as the snapshot path does.
 */

import { fetchDecodoSearchResult, isDecodoConfigured } from "./decodoClient";
import { fetchZenrowsSearchResult, isZenrowsConfigured } from "./zenrowsClient";
import { isSerpApiConfigured, searchAmazonViaSerpApi } from "./serpApi";
import { mapWithConcurrency } from "./concurrency";
import type { Marketplace } from "./types";

export type AsinDiscoveryProvider = "serpapi" | "zenrows" | "decodo";

/** A query plus where it came from, so a discovered ASIN can be traced back to the source that suggested searching for it. */
export interface DiscoveryQuery {
  query: string;
  /** Seed source id — "genre-seed", "comp-discovery", "persona-llm", "autocomplete", … */
  origin: string;
}

export interface DiscoveredAsin {
  asin: string;
  provider: AsinDiscoveryProvider;
  /** 1-based rank within the result list for `query`. */
  position: number;
  query: string;
  origin: string;
  title?: string;
  author?: string;
  price?: number;
}

export interface AsinDiscoveryResult {
  discovered: DiscoveredAsin[];
  /** Calls actually made per provider — SerpApi's are metered credits, so the caller reports them. */
  callsByProvider: Record<AsinDiscoveryProvider, number>;
  /** Providers that were configured and ran at all. */
  providersUsed: AsinDiscoveryProvider[];
}

export interface AsinDiscoveryOptions {
  /** SerpApi searches this run may spend (1 credit each). */
  serpApiBudget?: number;
  zenrowsBudget?: number;
  decodoBudget?: number;
  /** Queries in flight per provider. */
  concurrency?: number;
}

/**
 * Per-provider query budgets and in-flight limit. Sized so each provider
 * completes in roughly one round of its own 15s fetch timeout: competitor
 * generation runs under a 60s serverless limit and still has to spend time on
 * query generation before this and metadata enrichment after it.
 */
const DEFAULT_SERPAPI_BUDGET = 6;
const DEFAULT_ZENROWS_BUDGET = 6;
const DEFAULT_DECODO_BUDGET = 6;
const DEFAULT_CONCURRENCY = 6;
/** Results per query kept — past this, a search page is category filler rather than close competition. */
const MAX_RESULTS_PER_QUERY = 12;

/**
 * Dedupes and normalizes queries while preserving order, so the
 * highest-value seeds (the caller passes them first) get the budget.
 */
export function normalizeDiscoveryQueries(queries: DiscoveryQuery[]): DiscoveryQuery[] {
  const seen = new Set<string>();
  const out: DiscoveryQuery[] = [];
  for (const entry of queries) {
    const query = entry.query.replace(/\s+/g, " ").trim();
    if (query.length < 3 || query.length > 80) continue;
    const key = query.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ query, origin: entry.origin });
  }
  return out;
}

async function discoverViaSerpApi(
  queries: DiscoveryQuery[],
  marketplace: Marketplace,
  concurrency: number
): Promise<{ discovered: DiscoveredAsin[]; calls: number }> {
  const perQuery = await mapWithConcurrency(queries, concurrency, async ({ query, origin }) => {
    const search = await searchAmazonViaSerpApi(query, marketplace).catch((err: Error) => {
      console.error(`[asinDiscovery] SerpApi "${query}" failed:`, err.message);
      return null;
    });
    if (!search) return [] as DiscoveredAsin[];

    // organicProducts carries title/author/price alongside the ASIN, so these
    // rows land enriched without a per-ASIN product-page fetch. Bare `asins`
    // (sponsored slots, featured products) are kept too, just without metadata.
    const fromProducts = search.organicProducts.slice(0, MAX_RESULTS_PER_QUERY).map((product) => ({
      asin: product.asin,
      provider: "serpapi" as const,
      position: product.position,
      query,
      origin,
      title: product.title,
      author: product.author,
      price: product.price,
    }));

    const known = new Set(fromProducts.map((entry) => entry.asin));
    const extras = search.asins
      .filter((asin) => !known.has(asin))
      .slice(0, MAX_RESULTS_PER_QUERY)
      .map((asin, index) => ({
        asin,
        provider: "serpapi" as const,
        position: fromProducts.length + index + 1,
        query,
        origin,
      }));

    return [...fromProducts, ...extras];
  });

  return { discovered: perQuery.flat(), calls: queries.length };
}

async function discoverViaZenrows(
  queries: DiscoveryQuery[],
  marketplace: Marketplace,
  concurrency: number
): Promise<{ discovered: DiscoveredAsin[]; calls: number }> {
  const perQuery = await mapWithConcurrency(queries, concurrency, async ({ query, origin }) => {
    const { products } = await fetchZenrowsSearchResult(query, marketplace);
    return products.slice(0, MAX_RESULTS_PER_QUERY).map((product) => ({
      asin: product.asin,
      provider: "zenrows" as const,
      position: product.position,
      query,
      origin,
      title: product.title,
      author: product.author,
    }));
  });

  return { discovered: perQuery.flat(), calls: queries.length };
}

async function discoverViaDecodo(
  queries: DiscoveryQuery[],
  marketplace: Marketplace,
  concurrency: number
): Promise<{ discovered: DiscoveredAsin[]; calls: number }> {
  const perQuery = await mapWithConcurrency(queries, concurrency, async ({ query, origin }) => {
    const { products } = await fetchDecodoSearchResult(query, marketplace);
    return products.slice(0, MAX_RESULTS_PER_QUERY).map((product) => ({
      asin: product.asin,
      provider: "decodo" as const,
      position: product.position,
      query,
      origin,
      title: product.title,
      author: product.author,
    }));
  });

  return { discovered: perQuery.flat(), calls: queries.length };
}

/**
 * Runs the configured discovery providers over `queries` in parallel, each
 * capped by its own budget. Unconfigured providers contribute nothing and
 * cost nothing; a provider that errors on every query degrades to an empty
 * list rather than failing the run.
 */
export async function discoverCompetitorAsins(
  queries: DiscoveryQuery[],
  marketplace: Marketplace,
  options: AsinDiscoveryOptions = {}
): Promise<AsinDiscoveryResult> {
  const normalized = normalizeDiscoveryQueries(queries);
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const callsByProvider: Record<AsinDiscoveryProvider, number> = { serpapi: 0, zenrows: 0, decodo: 0 };

  if (normalized.length === 0) {
    return { discovered: [], callsByProvider, providersUsed: [] };
  }

  // `normalized` is already deduped and ordered best-first, so each provider
  // just takes the first N its budget allows.
  const take = (budget: number) => normalized.slice(0, Math.max(0, budget));
  const serpApiQueries = isSerpApiConfigured() ? take(options.serpApiBudget ?? DEFAULT_SERPAPI_BUDGET) : [];
  const zenrowsQueries = isZenrowsConfigured() ? take(options.zenrowsBudget ?? DEFAULT_ZENROWS_BUDGET) : [];
  const decodoQueries = isDecodoConfigured() ? take(options.decodoBudget ?? DEFAULT_DECODO_BUDGET) : [];

  const [serpApi, zenrows, decodo] = await Promise.all([
    serpApiQueries.length > 0
      ? discoverViaSerpApi(serpApiQueries, marketplace, concurrency)
      : Promise.resolve({ discovered: [] as DiscoveredAsin[], calls: 0 }),
    zenrowsQueries.length > 0
      ? discoverViaZenrows(zenrowsQueries, marketplace, concurrency)
      : Promise.resolve({ discovered: [] as DiscoveredAsin[], calls: 0 }),
    decodoQueries.length > 0
      ? discoverViaDecodo(decodoQueries, marketplace, concurrency)
      : Promise.resolve({ discovered: [] as DiscoveredAsin[], calls: 0 }),
  ]);

  callsByProvider.serpapi = serpApi.calls;
  callsByProvider.zenrows = zenrows.calls;
  callsByProvider.decodo = decodo.calls;

  const providersUsed = (["serpapi", "zenrows", "decodo"] as AsinDiscoveryProvider[]).filter(
    (provider) => callsByProvider[provider] > 0
  );

  return {
    discovered: [...serpApi.discovered, ...zenrows.discovered, ...decodo.discovered],
    callsByProvider,
    providersUsed,
  };
}
