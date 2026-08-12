/**
 * Competitor-ASIN discovery (lib/asinDiscovery.ts) and the provider-side ASIN
 * extraction it depends on.
 *
 * The behaviour under test is the fix for competitor generation drawing every
 * row from the snapshot crawl: SerpApi returned ASINs that the route dropped,
 * and the ZenRows/Decodo clients parsed their search results for keyword
 * terms only, never for the ASINs sitting in the same payload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeDiscoveryQueries } from "../lib/asinDiscovery";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

beforeEach(() => {
  vi.resetModules();
});

describe("normalizeDiscoveryQueries", () => {
  it("dedupes case-insensitively and keeps the first occurrence's order and origin", () => {
    const queries = normalizeDiscoveryQueries([
      { query: "  angela marsons  ", origin: "comp-discovery" },
      { query: "Angela Marsons", origin: "autocomplete" },
      { query: "dark scottish crime", origin: "persona-llm" },
    ]);

    expect(queries).toEqual([
      { query: "angela marsons", origin: "comp-discovery" },
      { query: "dark scottish crime", origin: "persona-llm" },
    ]);
  });

  it("drops queries that are too short or too long to be a real search", () => {
    const queries = normalizeDiscoveryQueries([
      { query: "ab", origin: "x" },
      { query: "a".repeat(200), origin: "x" },
      { query: "cozy mystery series", origin: "x" },
    ]);
    expect(queries.map((q) => q.query)).toEqual(["cozy mystery series"]);
  });
});

describe("discoverCompetitorAsins", () => {
  it("returns nothing and spends nothing when no provider is configured", async () => {
    delete process.env.SERPAPI_API_KEY;
    delete process.env.ZENROWS_API_KEY;
    delete process.env.DECODO_API_KEY;

    const { discoverCompetitorAsins } = await import("../lib/asinDiscovery");
    const result = await discoverCompetitorAsins([{ query: "cozy mystery series", origin: "genre-seed" }], "US");

    expect(result.discovered).toEqual([]);
    expect(result.providersUsed).toEqual([]);
    expect(result.callsByProvider).toEqual({ serpapi: 0, zenrows: 0, decodo: 0 });
  });

  it("caps each provider at its own budget and tags results with provider, query and origin", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    delete process.env.SERPAPI_API_KEY;
    delete process.env.DECODO_API_KEY;

    const html = `
      <div data-component-type="s-search-result" data-asin="B01AAAAAAA">
        <h2><span>Silent Scream</span></h2>
        <div class="a-row a-size-base a-color-secondary">by Angela Marsons</div>
      </div>
      <div data-component-type="s-search-result" data-asin="B01BBBBBBB">
        <h2><span>Evil Games</span></h2>
      </div>`;
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => html });
    vi.stubGlobal("fetch", mockFetch);

    const { discoverCompetitorAsins } = await import("../lib/asinDiscovery");
    const result = await discoverCompetitorAsins(
      [
        { query: "angela marsons", origin: "comp-discovery" },
        { query: "cozy mystery series", origin: "genre-seed" },
        { query: "small town detective", origin: "persona-llm" },
      ],
      "US",
      { zenrowsBudget: 2 }
    );

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result.callsByProvider).toEqual({ serpapi: 0, zenrows: 2, decodo: 0 });
    expect(result.providersUsed).toEqual(["zenrows"]);

    const first = result.discovered[0];
    expect(first).toMatchObject({
      asin: "B01AAAAAAA",
      provider: "zenrows",
      position: 1,
      query: "angela marsons",
      origin: "comp-discovery",
      title: "Silent Scream",
      author: "Angela Marsons",
    });
    // Both queries returned both ASINs — the caller dedupes and counts the
    // repeat as source agreement.
    expect(result.discovered).toHaveLength(4);
  });
});

describe("fetchZenrowsSearchResult", () => {
  it("parses keyword terms and ranking ASINs out of one search-results fetch", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    const html = `
      <div data-component-type="s-related-searches"><a>angela marsons books in order</a></div>
      <div data-component-type="s-search-result" data-asin="B01AAAAAAA">
        <h2><span>Silent Scream</span></h2>
        <div class="a-row a-size-base a-color-secondary">by Angela Marsons</div>
      </div>
      <div data-component-type="s-search-result" data-asin="NOTANASIN"><h2><span>Ignored</span></h2></div>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => html }));

    const { fetchZenrowsSearchResult } = await import("../lib/zenrowsClient");
    const { terms, products } = await fetchZenrowsSearchResult("angela marsons", "US");

    expect(terms).toEqual(["angela marsons books in order"]);
    expect(products).toEqual([
      { asin: "B01AAAAAAA", title: "Silent Scream", author: "Angela Marsons", position: 1 },
    ]);
  });

  it("degrades to empty lists when the fetch fails rather than throwing", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }));

    const { fetchZenrowsSearchResult } = await import("../lib/zenrowsClient");
    await expect(fetchZenrowsSearchResult("angela marsons", "US")).resolves.toEqual({ terms: [], products: [] });
  });
});

describe("fetchDecodoSearchResult", () => {
  it("reads ASINs off the organic results the term extraction already walks", async () => {
    process.env.DECODO_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            {
              content: {
                results: {
                  related_searches: ["nordic noir books"],
                  organic: [
                    { asin: "B01AAAAAAA", title: "Silent Scream", author: "Angela Marsons" },
                    { title: "No ASIN here" },
                  ],
                  paid: [{ asin: "B01CCCCCCC", title: "Sponsored Thriller" }],
                },
              },
            },
          ],
        }),
      })
    );

    const { fetchDecodoSearchResult } = await import("../lib/decodoClient");
    const { terms, products } = await fetchDecodoSearchResult("nordic noir", "US");

    expect(terms).toContain("nordic noir books");
    expect(products).toEqual([
      { asin: "B01AAAAAAA", title: "Silent Scream", author: "Angela Marsons", position: 1 },
      { asin: "B01CCCCCCC", title: "Sponsored Thriller", author: undefined, position: 2 },
    ]);
  });
});

describe("searchAmazonViaSerpApi", () => {
  it("returns organic products with ASIN, title, author, price and rank together", async () => {
    process.env.SERPAPI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          search_metadata: { status: "Success" },
          related_searches: [{ query: "cozy mystery series" }],
          organic_results: [
            {
              asin: "B01AAAAAAA",
              title: "Silent Scream: A Novel",
              author: "Angela Marsons",
              price: { raw: "$4.99" },
              position: 1,
            },
            { title: "No ASIN on this one" },
          ],
        }),
      })
    );

    const { searchAmazonViaSerpApi } = await import("../lib/serpApi");
    const search = await searchAmazonViaSerpApi("cozy mystery", "US");

    expect(search?.organicProducts).toEqual([
      { asin: "B01AAAAAAA", title: "Silent Scream: A Novel", author: "Angela Marsons", price: 4.99, position: 1 },
    ]);
    expect(search?.relatedSearches).toEqual(["cozy mystery series"]);
  });
});
