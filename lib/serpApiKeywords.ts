/**
 * SerpApi as a keyword source.
 *
 * The existing autocomplete sweep asks Amazon's unofficial completion
 * endpoint (and Google/YouTube/DuckDuckGo) what extends a prefix. SerpApi's
 * Amazon Search API answers a different and better question: what Amazon
 * itself publishes as *related searches* for a term, and which books rank
 * for it. Related searches are keyword expansions Amazon derived from real
 * shopper behaviour, so they need no drift filtering of the kind the
 * general-web engines do — but they still run the same pipeline afterwards.
 *
 * Everything here is credit-metered: one SerpApi call is one credit, so the
 * seed list is trimmed hard and the whole run is capped. With no key
 * configured, every function returns nothing and the pipeline is unchanged.
 */

import { getSerpApiAmazonAutocomplete, isSerpApiConfigured, searchAmazonViaSerpApi } from "./serpApi";
import type { KeywordCandidate, Marketplace } from "./types";

/** Related searches are the highest-value section, so seeds are few and deliberate. */
const MAX_SEARCH_SEEDS = 3;
const MAX_AUTOCOMPLETE_SEEDS = 4;
/** Ceiling on credits one generate run may spend on SerpApi. */
export const SERPAPI_KEYWORD_CREDIT_BUDGET = 8;

export interface SerpApiKeywordResult {
  candidates: KeywordCandidate[];
  /** ASINs seen while searching — product-targeting candidates, not keywords. */
  asins: string[];
  creditsUsed: number;
}

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Runs a small, bounded SerpApi sweep for one book: Amazon related searches
 * plus organic competitor titles/authors for the top seeds, and Amazon
 * autocomplete for the rest.
 *
 * Seeds should be genre/comp phrases, not the book's own title — a title
 * search returns the book itself and little else.
 */
export async function getSerpApiKeywordCandidates(
  seedTerms: string[],
  marketplace: Marketplace
): Promise<SerpApiKeywordResult> {
  const empty: SerpApiKeywordResult = { candidates: [], asins: [], creditsUsed: 0 };
  if (!isSerpApiConfigured()) return empty;

  const seeds = Array.from(new Set(seedTerms.map(clean).filter((seed) => seed.length >= 3)));
  if (seeds.length === 0) return empty;

  const searchSeeds = seeds.slice(0, MAX_SEARCH_SEEDS);
  const autocompleteSeeds = seeds.slice(0, MAX_AUTOCOMPLETE_SEEDS);
  const budget = Math.min(searchSeeds.length + autocompleteSeeds.length, SERPAPI_KEYWORD_CREDIT_BUDGET);

  const related = new Set<string>();
  const organic = new Set<string>();
  const suggestions = new Set<string>();
  const asins = new Set<string>();
  let creditsUsed = 0;

  const searches = await Promise.all(searchSeeds.map((seed) => searchAmazonViaSerpApi(seed, marketplace)));
  creditsUsed += searchSeeds.length;

  for (const search of searches) {
    if (!search) continue;
    for (const phrase of search.relatedSearches) related.add(clean(phrase));
    for (const title of search.organicTitles) organic.add(clean(title));
    for (const author of search.organicAuthors) organic.add(clean(author));
    for (const asin of search.asins) asins.add(asin);
  }

  if (creditsUsed < budget) {
    const remaining = autocompleteSeeds.slice(0, budget - creditsUsed);
    const results = await Promise.all(remaining.map((seed) => getSerpApiAmazonAutocomplete(seed, marketplace)));
    creditsUsed += remaining.length;
    for (const values of results) {
      for (const value of values) suggestions.add(clean(value));
    }
  }

  const candidates: KeywordCandidate[] = [
    ...Array.from(related).map((text) => ({ text, sources: ["serpapi-related" as const] })),
    ...Array.from(organic).map((text) => ({ text, sources: ["serpapi-organic" as const] })),
    ...Array.from(suggestions).map((text) => ({ text, sources: ["serpapi-autocomplete" as const] })),
  ].filter((candidate) => candidate.text.length >= 3);

  return { candidates, asins: Array.from(asins), creditsUsed };
}
