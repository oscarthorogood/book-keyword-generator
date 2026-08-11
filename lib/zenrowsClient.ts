/**
 * ZenRows Universal Scraper API, called live: https://api.zenrows.com/v1/ —
 * a general-purpose scraping proxy (JS rendering, rotating premium/
 * residential proxies, auto-retry) rather than a structured SERP API like
 * Decodo's, so this fetches Amazon's real search-results HTML for each seed
 * term and parses it locally instead of reading pre-parsed JSON.
 *
 * Mirrors lib/decodoClient.ts's shape: bounded to
 * ZENROWS_KEYWORD_CREDIT_BUDGET seed calls per generate run, every call
 * degrades to [] on any failure (unset key, non-2xx, unparseable/blocked
 * page) so callers never special-case it, and results are normalized into
 * the same lightweight { text, score } row shape lib/zenrowsSource.ts scores
 * and classifies.
 */

import * as cheerio from "cheerio";
import type { ZenrowsRow } from "./zenrowsSource";
import type { Marketplace } from "./types";

const ZENROWS_API_KEY = process.env.ZENROWS_API_KEY;
const ZENROWS_ENDPOINT = "https://api.zenrows.com/v1/";
const FETCH_TIMEOUT_MS = 15000;

/** Ceiling on live ZenRows calls one generate run may spend — mirrors DECODO_KEYWORD_CREDIT_BUDGET. */
export const ZENROWS_KEYWORD_CREDIT_BUDGET = 8;

const MARKETPLACE_DOMAINS: Record<Marketplace, string> = {
  US: "amazon.com",
  UK: "amazon.co.uk",
  CA: "amazon.ca",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
};

const MARKETPLACE_PROXY_COUNTRY: Record<Marketplace, string> = {
  US: "us",
  UK: "gb",
  CA: "ca",
  DE: "de",
  FR: "fr",
  IT: "it",
  ES: "es",
};

export function isZenrowsConfigured(): boolean {
  return !!ZENROWS_API_KEY;
}

function domainFor(marketplace: Marketplace): string {
  return MARKETPLACE_DOMAINS[marketplace] ?? MARKETPLACE_DOMAINS.US;
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches one Amazon search-results page for `query` through ZenRows'
 * proxy. Returns null on any failure so callers can degrade to [] instead of
 * special-casing — same contract as lib/decodoClient.ts's callDecodo.
 */
async function fetchAmazonSearchHtml(query: string, marketplace: Marketplace): Promise<string | null> {
  if (!ZENROWS_API_KEY) return null;

  const targetUrl = `https://www.${domainFor(marketplace)}/s?k=${encodeURIComponent(query)}`;
  const params = new URLSearchParams({
    apikey: ZENROWS_API_KEY,
    url: targetUrl,
    premium_proxy: "true",
    proxy_country: MARKETPLACE_PROXY_COUNTRY[marketplace] ?? "us",
  });

  try {
    const res = await fetchWithTimeout(`${ZENROWS_ENDPOINT}?${params.toString()}`, { method: "GET" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[zenrowsClient] search "${query}" failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.error(`[zenrowsClient] search "${query}" errored:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Pulls candidate search terms out of an Amazon search-results page: the
 * "related searches" strip Amazon shows at the bottom of results (the
 * highest-signal phrases, since Amazon itself generated them for this exact
 * query) plus organic result titles as a fallback when that strip is absent.
 */
function extractSearchTerms(html: string): string[] {
  const $ = cheerio.load(html);
  const terms: string[] = [];

  $("a.s-refinement-link, [data-component-type='s-related-searches'] a, .s-related-searches-cell a").each((_, el) => {
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (text) terms.push(text);
  });

  if (terms.length === 0) {
    $("[data-component-type='s-search-result'] h2 span").each((_, el) => {
      const text = $(el).text().replace(/\s+/g, " ").trim();
      if (text) terms.push(text);
    });
  }

  return terms;
}

/**
 * Runs a small, bounded live ZenRows sweep for a set of seed terms (same
 * seed pattern SerpApi/Decodo use: genre/comp phrases and series name, not
 * the book's own title) and normalizes whatever comes back into
 * ZenrowsRow[] so it flows through buildZenrowsCandidates unchanged.
 *
 * Bounded by ZENROWS_KEYWORD_CREDIT_BUDGET total calls (one search page per
 * seed) — this app has no visibility into ZenRows' actual pricing tier, so
 * the budget is a conservative guess mirroring SerpApi/Decodo's, not a
 * verified figure.
 */
export async function fetchZenrowsKeywordRows(seedTerms: string[], marketplace: Marketplace): Promise<ZenrowsRow[]> {
  if (!ZENROWS_API_KEY) return [];

  const seeds = Array.from(
    new Set(seedTerms.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 3))
  ).slice(0, ZENROWS_KEYWORD_CREDIT_BUDGET);
  if (seeds.length === 0) return [];

  const rows: ZenrowsRow[] = [];
  const seen = new Set<string>();

  const perSeed = await Promise.all(
    seeds.map(async (seed) => {
      const html = await fetchAmazonSearchHtml(seed, marketplace);
      return html ? extractSearchTerms(html) : [];
    })
  );

  for (const terms of perSeed) {
    // Rank within each seed's result list drives the score: first result
    // highest, decaying toward the tail — ZenRows' raw HTML has no relevance
    // score of its own, unlike Decodo's parsed JSON.
    terms.forEach((text, index) => {
      const normalized = text.replace(/\s+/g, " ").trim().toLowerCase();
      if (!normalized || normalized.length < 3 || seen.has(normalized)) return;
      seen.add(normalized);
      const score = Math.max(0.4, 1 - index * 0.05);
      rows.push({ text: normalized, score });
    });
  }

  return rows;
}
