import { CampaignIdentity } from "./types";

/**
 * Naming convention required by the downstream monitoring/harvesting tooling:
 * `PB_{creator initials}_{ASIN}_{Author}_{Series Name}_{Title}_{Country}_{SPA|SPM}_{variant}`
 *
 * e.g. `PB_MO_103671165X_Andrew Raymond_A DC Mairead Maclean Mystery_The Long Isle_UK_SPA_1`
 *
 * The monitor parses ASIN/Author back out of the campaign name with a plain
 * string split on "_", so every campaign this app creates must follow this
 * format exactly — no free-text campaign names. Field values may contain
 * spaces (they're the separator between *fields* that matters), but not the
 * "_" separator itself, so it's stripped out of each field.
 */
const FIELD_SEPARATOR = "_";

function sanitizeField(value: string): string {
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function buildCampaignName(identity: CampaignIdentity): string {
  const fields = [
    "PB",
    identity.creatorInitials,
    identity.asin,
    identity.authorName,
    identity.seriesName,
    identity.bookTitle,
    identity.marketplace,
    identity.campaignType,
    String(identity.variant),
  ];

  return fields
    .filter((field): field is string => !!field && field.trim().length > 0)
    .map((field) => (field === identity.marketplace || field === identity.campaignType ? field : sanitizeField(field)))
    .join(FIELD_SEPARATOR);
}

/**
 * Manual (SPM) campaigns split into separate ad groups per the research
 * blueprint's 3-campaign recommendation (section 5) — kept as ad groups
 * rather than separate campaigns so the naming convention's fixed field
 * count stays intact (see buildCampaignName above).
 */
export type SpmAdGroupCategory = "tropes" | "comp-names" | "product-targeting" | "harvested";

const SPM_AD_GROUP_NAMES: Record<SpmAdGroupCategory, string> = {
  tropes: "Tropes & Themes",
  "comp-names": "Comp Authors & Titles",
  "product-targeting": "Product Targeting",
  harvested: "Harvested Keywords",
};

export function buildAdGroupName(
  identity: Pick<CampaignIdentity, "campaignType">,
  category: SpmAdGroupCategory = "tropes"
): string {
  return identity.campaignType === "SPA" ? "Auto Targeting" : SPM_AD_GROUP_NAMES[category];
}

/** Parses a campaign name built by buildCampaignName back into its fields. Best-effort — returns null if the format doesn't match. */
export function parseCampaignName(campaignName: string): {
  creatorInitials: string;
  asin: string;
  authorName: string;
  seriesName?: string;
  bookTitle: string;
  marketplace: string;
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
