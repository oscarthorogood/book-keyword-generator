/**
 * Product- and brand-targeting candidates.
 *
 * Keyword targeting reaches readers who type something; product targeting
 * reaches readers already looking at a comparable book. The crawl already
 * collects the ASINs and authors needed for it — this ranks them so the
 * strongest competitors (bestselling, well reviewed) go first, and keeps
 * them out of the keyword list, where a bare ASIN matches nothing.
 *
 * Ranking follows the metadata spec: comparable ASINs and brands ordered by
 * best-seller rank and review count.
 */

import type { RelatedCompetitor } from "./types";

export interface ProductTarget {
  asin: string;
  title?: string;
  author?: string;
  /** 0-1 confidence that this is a competitor worth paying to appear beside. */
  score: number;
  rating?: number;
  reviewCount?: number;
  bestSellerRank?: number;
}

export interface BrandTarget {
  /** Author or publisher name — Amazon Ads brand targeting works on these. */
  brand: string;
  /** How many crawled competitors carry this brand. */
  titles: number;
  score: number;
}

/** Amazon caps a targeting expression list long before this; the cap is about focus, not the API. */
export const PRODUCT_TARGET_MAX = 60;
export const BRAND_TARGET_MAX = 25;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/**
 * Quality of one competitor as a targeting candidate. Rank is the most
 * reliable signal (it's a live sales proxy), then review count (audience
 * size), then rating (whether that audience liked it).
 */
export function competitorScore(competitor: RelatedCompetitor): number {
  let score = 0;

  if (competitor.bestSellerRank !== undefined) {
    if (competitor.bestSellerRank <= 100) score += 0.4;
    else if (competitor.bestSellerRank <= 1000) score += 0.3;
    else if (competitor.bestSellerRank <= 10000) score += 0.2;
    else score += 0.05;
  }

  if (competitor.reviewCount !== undefined) {
    if (competitor.reviewCount >= 1000) score += 0.35;
    else if (competitor.reviewCount >= 500) score += 0.25;
    else if (competitor.reviewCount >= 100) score += 0.15;
    else if (competitor.reviewCount >= 10) score += 0.05;
  }

  if (competitor.rating !== undefined) {
    if (competitor.rating >= 4.5) score += 0.25;
    else if (competitor.rating >= 4.0) score += 0.18;
    else if (competitor.rating >= 3.5) score += 0.1;
  }

  return Math.min(score, 1);
}

/**
 * Ranked ASIN targets from the competitor crawl plus any extra ASINs the
 * carousels surfaced. Deduped; ASIN-shaped strings only, so a title that
 * drifted into the ASIN list can't become a target.
 */
export function buildProductTargets(
  competitors: RelatedCompetitor[],
  extraAsins: string[] = [],
  limit = PRODUCT_TARGET_MAX
): ProductTarget[] {
  const byAsin = new Map<string, ProductTarget>();

  for (const competitor of competitors) {
    const asin = competitor.asin?.toUpperCase();
    if (!asin || !ASIN_PATTERN.test(asin)) continue;
    const score = competitorScore(competitor);
    const existing = byAsin.get(asin);
    if (existing && existing.score >= score) continue;
    byAsin.set(asin, {
      asin,
      title: competitor.title,
      author: competitor.author,
      rating: competitor.rating,
      reviewCount: competitor.reviewCount,
      bestSellerRank: competitor.bestSellerRank,
      score,
    });
  }

  for (const raw of extraAsins) {
    const asin = raw?.toUpperCase();
    if (!asin || !ASIN_PATTERN.test(asin) || byAsin.has(asin)) continue;
    // An ASIN with no metadata behind it is still a valid target, just an
    // unranked one — it sorts below everything the crawl could score.
    byAsin.set(asin, { asin, score: 0 });
  }

  return Array.from(byAsin.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Brand targets: the comparable authors (and publisher brands) worth
 * targeting as a whole catalogue rather than book by book. An author with
 * several strong titles in the crawl outranks one with a single mid-list
 * appearance.
 */
export function buildBrandTargets(
  competitors: RelatedCompetitor[],
  extraBrands: string[] = [],
  limit = BRAND_TARGET_MAX
): BrandTarget[] {
  const byBrand = new Map<string, { titles: number; total: number }>();

  for (const competitor of competitors) {
    const brand = competitor.author?.replace(/\s+/g, " ").trim();
    if (!brand || brand.length < 3) continue;
    const key = brand.toLowerCase();
    const entry = byBrand.get(key) ?? { titles: 0, total: 0 };
    entry.titles += 1;
    entry.total += competitorScore(competitor);
    byBrand.set(key, entry);
  }

  for (const raw of extraBrands) {
    const brand = raw?.replace(/\s+/g, " ").trim();
    if (!brand || brand.length < 3) continue;
    const key = brand.toLowerCase();
    if (byBrand.has(key)) continue;
    byBrand.set(key, { titles: 1, total: 0.1 });
  }

  return Array.from(byBrand.entries())
    .map(([brand, entry]) => ({
      brand,
      titles: entry.titles,
      // Average quality, nudged up by how many titles back the brand.
      score: Math.min(entry.total / entry.titles + Math.min(entry.titles - 1, 3) * 0.05, 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
