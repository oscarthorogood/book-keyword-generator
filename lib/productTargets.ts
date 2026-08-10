import { isValidProductAsin } from "./asinValidation";
import { KeywordSource, ProductTargetCandidate } from "./types";

const ASIN_PATTERN = /^[A-Z0-9]{10}$/i;

// Caps the Product Targeting ad group at a sane size — the deep 2-hop crawl
// in lib/scrape.ts can surface up to ~11 ASINs on its own, plus whatever the
// ads-api/autocomplete ASIN routing adds on top.
export const PRODUCT_TARGET_MAX = 30;

/**
 * Check if text looks like an ASIN (10-character alphanumeric).
 * This is a fast, format-only check. Use isValidProductAsin() for full validation.
 */
export function looksLikeAsin(text: string): boolean {
  return ASIN_PATTERN.test(text.trim());
}

/**
 * Build product target candidates, validating ASINs to prevent invalid ones
 * from reaching the bulksheet (§2.2 from audit). Rejects placeholder strings
 * like "CLOVERLEAF" that shouldn't ever be shipped to Amazon Ads.
 */
export function buildProductTargetCandidates(
  compAsins: string[],
  source: KeywordSource
): ProductTargetCandidate[] {
  const seen = new Set<string>();
  const candidates: ProductTargetCandidate[] = [];
  const rejected: string[] = [];

  for (const raw of compAsins) {
    const asin = raw.trim().toUpperCase();

    // Validate with full ASIN/ISBN validation (not just format check)
    // This catches placeholder strings like "CLOVERLEAF" or invalid formats
    if (!isValidProductAsin(asin)) {
      rejected.push(raw);
      continue;
    }

    if (seen.has(asin)) continue;
    seen.add(asin);
    candidates.push({ asin, sources: [source] });
  }

  // Log rejected ASINs for debugging
  if (rejected.length > 0) {
    console.warn(
      `[buildProductTargetCandidates] Rejected ${rejected.length} invalid/placeholder ASINs:`,
      rejected.slice(0, 5)
    );
  }

  return candidates;
}

/**
 * Merge product target candidates from multiple sources, validating ASINs
 * before they're combined. Ensures invalid ASINs are caught early, not at
 * bulksheet export time (§2.2).
 */
export function mergeProductTargetCandidates(
  ...groups: ProductTargetCandidate[][]
): ProductTargetCandidate[] {
  const merged = new Map<string, ProductTargetCandidate>();

  for (const group of groups) {
    for (const candidate of group) {
      const asin = candidate.asin.trim().toUpperCase();

      // Validate ASIN format and reject placeholders
      if (!isValidProductAsin(asin)) {
        console.warn(
          `[mergeProductTargetCandidates] Skipping invalid ASIN: "${candidate.asin}"`
        );
        continue;
      }

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
