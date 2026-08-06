import { KeywordCandidate } from "./types";

const DATAMUSE_TIMEOUT_MS = 4000;
const MAX_SYNONYMS_PER_TERM = 6;
const MAX_SEED_TERMS = 6;

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Datamuse (api.datamuse.com) — free, no key, no signup, no scraping-block
 * risk (it's a real API, not a page scrape). "Means like" surfaces
 * related/synonym words for a seed term, catching buyer language the
 * alphabet-soup autocomplete sweep can't reach because it only extends a
 * prefix (e.g. "detective" -> "sleuth", "investigator", "gumshoe" — none of
 * which share a prefix with "detective").
 */
async function getRelatedWords(term: string): Promise<string[]> {
  const url = `https://api.datamuse.com/words?ml=${encodeURIComponent(term)}&max=${MAX_SYNONYMS_PER_TERM}`;
  try {
    const res = await fetchWithTimeout(url, DATAMUSE_TIMEOUT_MS);
    if (!res.ok) return [];
    const json = (await res.json()) as { word?: string }[];
    return json.map((entry) => entry.word).filter((w): w is string => !!w);
  } catch {
    return [];
  }
}

/**
 * Expands the top genre/trope terms into synonym-based candidates. Only
 * short (<=2 word) seed terms get queried — Datamuse's "means like" works on
 * individual concepts, not full phrases — and only a handful of them, to
 * keep the request count bounded. Each related word is kept bare and
 * templated with "books", mirroring buildBuyerIntentCandidates.
 */
export async function getSynonymExpansionCandidates(seedTerms: string[]): Promise<KeywordCandidate[]> {
  const candidateSeeds = seedTerms
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0 && t.split(" ").length <= 2)
    .slice(0, MAX_SEED_TERMS);

  if (candidateSeeds.length === 0) return [];

  const results = await Promise.all(candidateSeeds.map((term) => getRelatedWords(term)));

  const texts = new Set<string>();
  for (const words of results) {
    for (const raw of words) {
      // Datamuse joins some multi-word suggestions with underscores.
      const clean = raw.trim().toLowerCase().replace(/_/g, " ");
      if (!clean) continue;
      texts.add(clean);
      texts.add(`${clean} books`);
    }
  }

  return Array.from(texts).map((text) => ({ text, sources: ["synonym" as const] }));
}
