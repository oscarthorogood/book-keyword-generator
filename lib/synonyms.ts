// Controlled genre synonym expansion.
//
// This used to be an open-ended thesaurus: every genre term was looked up in
// a curated map *and* (via lib/datamuse.ts) in a general-purpose "means like"
// API. General-purpose thesauri answer "crime" with "law-breaking",
// "perpetrator" and "infringement", and "scottish" with "erse", "scotch" and
// "scotia" — so the keyword list ended up bidding on "felon books" and "erse
// books". None of those is a phrase a book buyer types.
//
// Expansion is now allowlist-only: a genre phrase maps to other *genre
// phrases* readers actually search, or it does not expand at all. Nationality
// and setting words are never expanded, and neither are bare emotional tokens
// ("thrill", "hot"). The map lives in lib/keywordFilterConfig.ts next to the
// filter that enforces the same rule downstream.

import { ALLOWED_GENRE_SYNONYMS, NEVER_EXPAND_TERMS } from "./keywordFilterConfig";

function normalizeTerm(term: string): string {
  return term.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True for terms that must never be handed to any synonym expansion. */
export function isExpansionBlocked(term: string): boolean {
  const normalized = normalizeTerm(term);
  return NEVER_EXPAND_TERMS.includes(normalized);
}

/**
 * Expands each of `terms` (the genre vocabulary already resolved from the
 * book's own metadata) into the related genre phrases allowed for it. Pure
 * local lookup — no network call, no open-ended expansion.
 *
 * A term matches an entry when it *is* that entry or contains it as a whole
 * phrase ("scottish crime fiction" → the "crime fiction" entry), so a
 * qualified genre string still expands, but a substring collision inside a
 * word ("scotia" inside nothing meaningful) cannot invent one.
 */
export function expandSynonyms(terms: string[], limit = 8): string[] {
  const out = new Set<string>();

  for (const term of terms.slice(0, limit)) {
    const normalized = normalizeTerm(term);
    if (!normalized || isExpansionBlocked(normalized)) continue;

    for (const [key, synonyms] of Object.entries(ALLOWED_GENRE_SYNONYMS)) {
      const isMatch =
        normalized === key || new RegExp(`(^|\\s)${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(normalized);
      if (!isMatch) continue;
      for (const synonym of synonyms) {
        if (synonym !== normalized) out.add(synonym);
      }
    }
  }

  return Array.from(out);
}

/** Every phrase the allowlist can ever produce — used by the synonym filter to police its own source. */
export function allowedSynonymPhrases(): string[] {
  return Array.from(new Set([...Object.keys(ALLOWED_GENRE_SYNONYMS), ...Object.values(ALLOWED_GENRE_SYNONYMS).flat()]));
}
