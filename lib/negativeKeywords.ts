/**
 * Negative keyword strategy for Amazon Ads campaigns (§3.1 from audit).
 *
 * Current bulksheets ship zero negative keywords despite running Broad and Phrase
 * match on ~150 keywords — negative keywords are one of the highest-ROI activities
 * in book PPC (industry estimates: ~1/3 of ad clicks come from non-converting terms
 * that negatives would catch).
 *
 * This module generates a starter negative-keyword list to ship with every bulksheet,
 * seeded with proven patterns from real search term reports + the audit findings.
 */

export interface NegativeKeywordSet {
  campaignLevel: string[]; // Applied to all ad groups in the campaign
  adGroupLevel: Record<string, string[]>; // Per-ad-group negatives
}

/**
 * Campaign-level negative keywords (applies to entire campaign).
 * These are universally non-converting for books, regardless of genre.
 */
const CAMPAIGN_LEVEL_NEGATIVES = [
  // Spoilers/summaries — person already has book or doesn't want it
  "-spoiler",
  "-spoilers",
  "-spoiler alert",
  "-ending",
  "-plot summary",
  "-book summary",
  "-summary",
  "-reviews",

  // Movie/TV/adaptation searches — wrong medium entirely
  "-movie",
  "-movies",
  "-film",
  "-films",
  "-tv",
  "-tv series",
  "-netflix",
  "-adaptation",
  "-amazon prime video",

  // Piracy & free-seeking keywords — non-paying audience (§3.6)
  "-free",
  "-free download",
  "-free pdf",
  "-pdf",
  "-torrent",
  "-ebook free",
  "-free audiobook",
  "-free read",

  // Regional/local intent — nonsensical for ebooks
  "-near me",
  "-nearby",
  "-local",
  "-book club",
  "-library",

  // Non-fiction specific patterns that shouldn't match fiction
  "-how to",
  "-guide to",
  "-tutorial",
  "-course",
  "-training",

  // Competing genre/category (generic, catch-all; genre-specific refinements below)
  "-children's",
  "-kids",
  "-picture book",
  "-coloring",
  "-crossword",
  "-puzzle",
];

/**
 * Ad group-specific negatives for the "Tropes & Themes" group.
 * Filters out non-buying-intent variants of genre/mood keywords.
 */
const TROPES_AD_GROUP_NEGATIVES = [
  // Avoid the genre when combined with non-buying signals
  "-analysis",
  "-explained",
  "-meaning",
  "-definition",
  "-essay",
  "-study",
  "-academic",
  "-scholarship",

  // Avoid metadata/structural keywords
  "-table of contents",
  "-index",
  "-glossary",
  "-footnotes",

  // Competitive keyword blocking (generic; authors should add their comps explicitly)
  "-by stephen king",
  "-by james patterson",
  "-by nora roberts",
];

/**
 * Ad group-specific negatives for the "Comp Authors & Titles" group.
 * These protect against false matches (typos, homonyms, unrelated people).
 */
const COMP_NAMES_AD_GROUP_NEGATIVES = [
  // Broad match can pick up unrelated people/things with same name
  "-the character",
  "-the author",
  "-the band",
  "-the actress",
  "-the company",
  "-the tv show",
  "-lyrics",
  "-songs",
  "-albums",
  "-movie cast",
  "-actor",
  "-actress",
  "-musician",

  // Avoid metadata of other people's books
  "-book club discussion",
  "-discussion questions",
  "-reading guide",
  "-study guide",
];

/**
 * Ad group-specific negatives for the "Product Targeting" group.
 * These filter out non-book products that might show on Amazon product pages.
 */
const PRODUCT_TARGETING_AD_GROUP_NEGATIVES = [
  // Non-book products from adjacent categories
  "-notebook",
  "-journal",
  "-diary",
  "-planner",
  "-calendar",
  "-bookmark",
  "-book sleeve",
  "-book stand",
  "-reading light",
  "-book bag",
  "-merchandise",
  "-poster",
  "-sticker",
  "-figurine",
  "-action figure",

  // Media other than books
  "-movie",
  "-film",
  "-tv series",
  "-documentary",
  "-game",
  "-board game",
  "-video game",

  // Services/subscriptions
  "-subscription",
  "-membership",
  "-access",
  "-course",
  "-class",
  "-coaching",
];

/**
 * Build the negative keyword set for a campaign + its ad groups.
 * Returns campaign-level negatives and per-ad-group overrides.
 */
export function buildNegativeKeywordSet(): NegativeKeywordSet {
  return {
    campaignLevel: CAMPAIGN_LEVEL_NEGATIVES,
    adGroupLevel: {
      "Tropes & Themes": TROPES_AD_GROUP_NEGATIVES,
      "Comp Authors & Titles": COMP_NAMES_AD_GROUP_NEGATIVES,
      "Product Targeting": PRODUCT_TARGETING_AD_GROUP_NEGATIVES,
    },
  };
}

/**
 * Format negative keywords for export to bulksheet.
 * Returns text that describes the negative keyword strategy in a comment/metadata row.
 */
export function describeNegativeKeywordStrategy(): string {
  const total =
    CAMPAIGN_LEVEL_NEGATIVES.length +
    TROPES_AD_GROUP_NEGATIVES.length +
    COMP_NAMES_AD_GROUP_NEGATIVES.length +
    PRODUCT_TARGETING_AD_GROUP_NEGATIVES.length;

  return (
    `Negative Keyword Strategy: ${total} total negatives seeded (campaign + per-ad-group). ` +
    `Recommended workflow: run campaign 5-7 days, pull Search Term Report, ` +
    `harvest underperforming terms, add to negatives weekly. ` +
    `See lib/negativeKeywords.ts for initial seed list.`
  );
}
