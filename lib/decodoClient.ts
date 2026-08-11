/**
 * Decodo (formerly Smartproxy) Web Scraping / SERP API, called live.
 *
 * lib/decodoSource.ts already turns pre-supplied Decodo CSV/JSON export rows
 * into keyword candidates — this file is the other half: fetching those rows
 * itself instead of requiring the user to paste an export every time. It only
 * produces `DecodoRow[]`; everything downstream (relevance threshold,
 * branded/mood classification, specificity scoring) stays in decodoSource.ts
 * unchanged, same as the manual-paste path.
 *
 * ASSUMPTION (unverified against Decodo's real docs — check before flipping
 * DECODO_API_KEY on): this targets Decodo's single-endpoint SERP Scraping API
 * at POST https://scraper-api.decodo.com/v2/scrape, `Authorization: Bearer
 * <key>`, body `{ target: "amazon_search" | "amazon_autocomplete", query,
 * domain, parse: true }`, modelled on the shape Decodo documents for other
 * `target`s: `{ results: [{ content: { results: { organic: [...], related_searches:
 * [...] } } }] }` for a parsed search job, and a flatter `{ results: [{
 * content: [...] }] }` (an array of suggestion strings) for autocomplete.
 * Every field is read as `unknown` and narrowed at the point of use — as in
 * lib/serpApi.ts — so a wrong guess about the exact shape degrades to an
 * empty result for that seed rather than throwing.
 */

import type { DecodoRow } from "./decodoSource";
import type { Marketplace } from "./types";

const DECODO_API_KEY = process.env.DECODO_API_KEY;
const DECODO_ENDPOINT = "https://scraper-api.decodo.com/v2/scrape";
const FETCH_TIMEOUT_MS = 15000;

/** Ceiling on live Decodo calls one generate run may spend — mirrors SERPAPI_KEYWORD_CREDIT_BUDGET. */
export const DECODO_KEYWORD_CREDIT_BUDGET = 8;

const MARKETPLACE_DOMAINS: Record<Marketplace, string> = {
  US: "amazon.com",
  UK: "amazon.co.uk",
  CA: "amazon.ca",
  DE: "amazon.de",
  FR: "amazon.fr",
  IT: "amazon.it",
  ES: "amazon.es",
};

export function isDecodoConfigured(): boolean {
  return !!DECODO_API_KEY;
}

type JsonRecord = Record<string, unknown>;

function rec(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
 * One Decodo scrape job. Returns null on any failure — unset key, non-2xx,
 * unparseable body — so callers can degrade to [] instead of special-casing.
 */
async function callDecodo(target: string, query: string, marketplace: Marketplace): Promise<JsonRecord | null> {
  if (!DECODO_API_KEY) return null;

  try {
    const res = await fetchWithTimeout(DECODO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DECODO_API_KEY}`,
      },
      body: JSON.stringify({ target, query, domain: domainFor(marketplace), parse: true }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[decodoClient] ${target} "${query}" failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 300)}` : ""}`);
      return null;
    }
    return rec(await res.json()) ?? null;
  } catch (err) {
    console.error(`[decodoClient] ${target} "${query}" errored:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Pulls related-search / organic-title strings out of a parsed
 * "amazon_search" job's first result, in rank order (rank drives the
 * derived score below since Decodo's structured export rows carry a score
 * field this live path has to synthesize).
 */
function extractSearchTerms(data: JsonRecord): string[] {
  const firstResult = rec(list(data.results)[0]);
  const content = rec(firstResult?.content);
  const results = rec(content?.results) ?? content;

  const terms: string[] = [];
  for (const entry of list(results?.related_searches)) {
    const text = str(entry) ?? str(rec(entry)?.query) ?? str(rec(entry)?.title);
    if (text) terms.push(text);
  }
  for (const entry of list(results?.organic)) {
    const text = str(rec(entry)?.title);
    if (text) terms.push(text);
  }
  return terms;
}

/** Autocomplete jobs come back as a flat list of suggestion strings (or {value} objects). */
function extractAutocompleteTerms(data: JsonRecord): string[] {
  const firstResult = rec(list(data.results)[0]);
  const content = firstResult?.content;
  const entries = Array.isArray(content) ? content : list(rec(content)?.suggestions);

  const terms: string[] = [];
  for (const entry of entries) {
    const text = str(entry) ?? str(rec(entry)?.value) ?? str(rec(entry)?.query);
    if (text) terms.push(text);
  }
  return terms;
}

/**
 * Runs a small, bounded live Decodo sweep for a set of seed terms (same seed
 * pattern SerpApi uses: genre/comp phrases and series name, not the book's
 * own title) and normalizes whatever comes back into DecodoRow[] so it flows
 * through buildDecodoCandidates unchanged from the manual-paste path.
 *
 * Bounded by DECODO_KEYWORD_CREDIT_BUDGET total calls (one search job per
 * seed) — this app has no visibility into Decodo's actual pricing, so the
 * budget is a conservative guess mirroring SerpApi's, not a verified figure.
 */
export async function fetchDecodoKeywordRows(seedTerms: string[], marketplace: Marketplace): Promise<DecodoRow[]> {
  if (!DECODO_API_KEY) return [];

  const seeds = Array.from(
    new Set(seedTerms.map((s) => s.replace(/\s+/g, " ").trim()).filter((s) => s.length >= 3))
  ).slice(0, DECODO_KEYWORD_CREDIT_BUDGET);
  if (seeds.length === 0) return [];

  const rows: DecodoRow[] = [];
  const seen = new Set<string>();

  const perSeed = await Promise.all(
    seeds.map(async (seed) => {
      const data = await callDecodo("amazon_search", seed, marketplace);
      if (!data) return [] as string[];
      const terms = extractSearchTerms(data);
      return terms.length > 0 ? terms : extractAutocompleteTerms(data);
    })
  );

  for (const terms of perSeed) {
    // Rank within each seed's result list drives the score: first result
    // highest, decaying toward the tail — the closest available proxy for
    // Decodo's own relevance score, which the parsed shape doesn't expose.
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
