import { ProductPageData } from "./types";

/**
 * Book quality scoring for boosting keywords from high-quality comparable books.
 * Books with higher ratings, more reviews, and better bestseller rankings are
 * more credible sources for competitor keywords.
 *
 * This is used to boost "comp-name" keywords (competitor author/title) based on
 * whether that competitor is a bestseller or has excellent reviews.
 */

export interface BookQuality {
  /** 0-5 star rating, e.g., 4.5 */
  rating?: number;
  /** Number of customer reviews/ratings */
  reviewCount?: number;
  /** Best seller rank (lower is better), or undefined if not ranked */
  bestSellerRank?: number;
}

/**
 * Compute a book quality score from 0-100, used to boost keywords from
 * high-quality competitors. Factors:
 * - Bestseller rank (if #1-100, score +25; #101-1000, +15; higher +5)
 * - Rating (4.5+: +20, 4.0+: +15, 3.5+: +10, lower: +5)
 * - Review count (1000+: +20, 500+: +15, 100+: +10, lower: +5)
 */
export function scoreBookQuality(quality: BookQuality | undefined): number {
  if (!quality) return 0;

  let score = 0;

  // Bestseller rank signal (most reliable)
  if (quality.bestSellerRank !== undefined) {
    if (quality.bestSellerRank <= 100) score += 25;
    else if (quality.bestSellerRank <= 1000) score += 15;
    else if (quality.bestSellerRank <= 10000) score += 10;
    else score += 5;
  }

  // Rating signal
  if (quality.rating !== undefined) {
    if (quality.rating >= 4.5) score += 20;
    else if (quality.rating >= 4.0) score += 15;
    else if (quality.rating >= 3.5) score += 10;
    else score += 5;
  }

  // Review count signal (social proof)
  if (quality.reviewCount !== undefined) {
    if (quality.reviewCount >= 1000) score += 20;
    else if (quality.reviewCount >= 500) score += 15;
    else if (quality.reviewCount >= 100) score += 10;
    else if (quality.reviewCount >= 10) score += 5;
  }

  return Math.min(score, 100);
}

/**
 * Boost factor based on book quality (0-0.3 multiplier).
 * A bestselling book with 4.5+ rating gets +0.3 to keyword scores;
 * an unranked book with no reviews gets +0.
 */
export function qualityBoostMultiplier(quality: BookQuality | undefined): number {
  const score = scoreBookQuality(quality);
  // Linear map: 0 score → 0x, 100 score → 0.3x
  return (score / 100) * 0.3;
}

/**
 * Extract book quality metrics from a product page.
 */
export function extractBookQuality(page: ProductPageData): BookQuality {
  return {
    rating: page.rating,
    reviewCount: page.reviewCount,
    bestSellerRank: page.bestSellerRanks?.[0]?.rank,
  };
}
