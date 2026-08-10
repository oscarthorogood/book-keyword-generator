import { CampaignIdentity } from "./types";

/**
 * Naming convention required by the downstream monitoring tooling:
 * `PB_{creator initials}_{ASIN}_{Author}_{Series Name}_{Title}_{Country}_SPM_{variant}`
 *
 * e.g. `PB_MO_103671165X_Andrew Raymond_A DC Mairead Maclean Mystery_The Long Isle_UK_SPM_1`
 *
 * The monitor parses ASIN/Author back out of the campaign name with a plain
 * string split on "_", so every campaign this app creates must follow this
 * format exactly — no free-text campaign names. Field values may contain
 * spaces (they're the separator between *fields* that matters), but not the
 * "_" separator itself, so it's stripped out of each field. The "SPM" token
 * is fixed rather than a real variable — this app only ever builds Manual
 * campaigns — but it's kept in the name so the field count/position stays
 * exactly what downstream tooling already expects.
 */
const FIELD_SEPARATOR = "_";
const CAMPAIGN_TYPE_TOKEN = "SPM";

function sanitizeField(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function abbreviateSeriesName(seriesName: string): string {
  if (!seriesName) return "";

  const words = seriesName.trim().split(/\s+/);
  if (words.length <= 2) return seriesName;

  // If series name is very long, use first letter of each word
  if (seriesName.length > 20) {
    return words.map((w) => w[0]).join("").toUpperCase();
  }

  return seriesName;
}

function abbreviateBookTitle(bookTitle: string, seriesName?: string): string {
  if (!bookTitle) return "";

  let title = bookTitle;

  // Remove series name and book number information from title if present
  if (seriesName) {
    // Remove parenthetical series info like "(The Summer Suspense Mysteries Book 5)"
    title = title.replace(/\s*\([^)]*Book\s+\d+[^)]*\)/gi, "").trim();
    // Remove series name if it appears elsewhere
    title = title.replace(new RegExp(`\\s+${seriesName}`, "gi"), "").trim();
  }

  // Shorten if still too long
  if (title.length > 35) {
    // Try to use text before colon (e.g., "The Lizard: A Summer Suspense Mystery" → "The Lizard")
    const colonIdx = title.indexOf(":");
    if (colonIdx > 0 && colonIdx < 30) {
      title = title.substring(0, colonIdx).trim();
    } else {
      // Use first 2-3 words
      const words = title.split(/\s+/);
      title = words.slice(0, 3).join(" ");
    }
  }

  return title;
}

export function buildCampaignName(identity: CampaignIdentity, shortenedFormat = true): string {
  const series = shortenedFormat && identity.seriesName ? abbreviateSeriesName(identity.seriesName) : identity.seriesName;
  const title = shortenedFormat && identity.bookTitle ? abbreviateBookTitle(identity.bookTitle, identity.seriesName) : identity.bookTitle;

  const fields = [
    "PB",
    identity.creatorInitials,
    identity.asin,
    identity.authorName,
    series,
    title,
    identity.marketplace,
    CAMPAIGN_TYPE_TOKEN,
    String(identity.variant),
  ];

  return fields
    .filter((field): field is string => !!field && field.trim().length > 0)
    .map((field) => (field === identity.marketplace || field === CAMPAIGN_TYPE_TOKEN ? field : sanitizeField(field)))
    .join(FIELD_SEPARATOR);
}

/**
 * Manual campaigns split into separate ad groups per the research
 * blueprint's 3-campaign recommendation (section 5) — kept as ad groups
 * rather than separate campaigns so the naming convention's fixed field
 * count stays intact (see buildCampaignName above).
 */
export type SpmAdGroupCategory = "tropes" | "comp-names" | "product-targeting";

const SPM_AD_GROUP_NAMES: Record<SpmAdGroupCategory, string> = {
  tropes: "Tropes & Themes",
  "comp-names": "Comp Authors & Titles",
  "product-targeting": "Product Targeting",
};

export function buildAdGroupName(category: SpmAdGroupCategory = "tropes"): string {
  return SPM_AD_GROUP_NAMES[category];
}

/** Parses a campaign name built by buildCampaignName back into its fields. Best-effort — returns null if the format doesn't match. */
export function parseCampaignName(campaignName: string): {
  creatorInitials: string;
  asin: string;
  authorName: string;
  seriesName?: string;
  bookTitle: string;
  marketplace: string;
  /** Always "SPM" — kept as a field for compatibility with the downstream format, not a real variable here. */
  campaignType: string;
  variant: string;
} | null {
  const parts = campaignName.split(FIELD_SEPARATOR);
  if (parts.length < 8 || parts[0] !== "PB") return null;

  const hasSeries = parts.length >= 9;
  const [, creatorInitials, asin, authorName, seriesName, bookTitle, marketplace, campaignType, variant] = hasSeries
    ? parts
    : [parts[0], parts[1], parts[2], parts[3], undefined, parts[4], parts[5], parts[6], parts[7]];

  return {
    creatorInitials,
    asin,
    authorName,
    seriesName,
    bookTitle,
    marketplace,
    campaignType,
    variant,
  };
}
