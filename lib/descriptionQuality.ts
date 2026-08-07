/**
 * Description quality scoring for boosting related keywords based on
 * how rich and informative the product description is.
 *
 * A longer, more detailed description is a stronger signal that keywords
 * extracted from it are representative of the book's actual content.
 */

export interface DescriptionQuality {
  description?: string;
  bulletPoints: string[];
}

/**
 * Score description quality from 0-100 based on length and detail.
 * Longer, richer descriptions are stronger signals.
 */
export function scoreDescriptionQuality(quality: DescriptionQuality): number {
  let score = 0;

  // Description length bonus (0-50 points)
  const descLength = quality.description?.length ?? 0;
  if (descLength >= 2000) score += 50;
  else if (descLength >= 1500) score += 40;
  else if (descLength >= 1000) score += 30;
  else if (descLength >= 500) score += 20;
  else if (descLength >= 200) score += 10;

  // Bullet points bonus (0-30 points)
  const bulletCount = quality.bulletPoints?.length ?? 0;
  if (bulletCount >= 8) score += 30;
  else if (bulletCount >= 6) score += 20;
  else if (bulletCount >= 4) score += 10;
  else if (bulletCount >= 2) score += 5;

  // Presence check: if we have meaningful content, boost (0-20 points)
  if (descLength > 500 && bulletCount >= 4) {
    score += 20;
  } else if (descLength > 300 || bulletCount >= 3) {
    score += 10;
  }

  return Math.min(score, 100);
}

/**
 * Get boost multiplier (0-0.2) for keywords from rich descriptions.
 * Publishers who write good marketing copy = better keyword signals.
 */
export function descriptionQualityBoostMultiplier(quality: DescriptionQuality): number {
  const score = scoreDescriptionQuality(quality);
  // Linear map: 0 score → 0x, 100 score → 0.2x
  return (score / 100) * 0.2;
}

/**
 * Boost keyword scores based on description quality.
 * Keywords mined from rich descriptions are more trustworthy.
 */
export function boostScoresByDescriptionQuality(
  candidates: any[],
  quality: DescriptionQuality,
  descriptionSource: string = "book-description"
): any[] {
  const boost = descriptionQualityBoostMultiplier(quality);
  if (boost <= 0) return candidates;

  return candidates.map((candidate) => {
    // Only boost keywords that came from description-related sources
    if (
      candidate.sources.includes(descriptionSource) ||
      candidate.sources.includes("comp-name") // comp mentions are in description
    ) {
      const scoreBoost = boost * 10;
      return { ...candidate, score: (candidate.score ?? 0) + scoreBoost };
    }
    return candidate;
  });
}
