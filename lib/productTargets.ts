import { KeywordSource, ProductTargetCandidate } from "./types";

const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

// Caps the Product Targeting ad group at a sane size — the deep 2-hop crawl
// in lib/scrape.ts can surface up to ~11 ASINs on its own, plus whatever the
// ads-api/autocomplete ASIN routing adds on top.
export const PRODUCT_TARGET_MAX = 30;

export function looksLikeAsin(text: string): boolean {
  return ASIN_PATTERN.test(text.trim());
}

export function buildProductTargetCandidates(
  compAsins: string[],
  source: KeywordSource
): ProductTargetCandidate[] {
  const seen = new Set<string>();
  const candidates: ProductTargetCandidate[] = [];

  for (const raw of compAsins) {
    const asin = raw.trim().toUpperCase();
    if (!looksLikeAsin(asin) || seen.has(asin)) continue;
    seen.add(asin);
    candidates.push({ asin, sources: [source] });
  }

  return candidates;
}

export function mergeProductTargetCandidates(
  ...groups: ProductTargetCandidate[][]
): ProductTargetCandidate[] {
  const merged = new Map<string, ProductTargetCandidate>();

  for (const group of groups) {
    for (const candidate of group) {
      const asin = candidate.asin.toUpperCase();
      if (!looksLikeAsin(asin)) continue;

      const existing = merged.get(asin);
      if (existing) {
        existing.sources = Array.from(new Set([...existing.sources, ...candidate.sources]));
        existing.suggestedBid = existing.suggestedBid ?? candidate.suggestedBid;
      } else {
        merged.set(asin, { ...candidate, asin });
      }
    }
  }

  return Array.from(merged.values());
}
