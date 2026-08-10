/**
 * Amazon Ads bulk-upload export.
 *
 * The keyword list is research output until it can be uploaded, and the Ads
 * console's bulk operations take a flat sheet of entity rows: campaign, then
 * ad group, then one row per keyword / negative keyword / product target,
 * each naming its parent by name. This writes that sheet as CSV.
 *
 * Structure follows the SerpApi guide's suggested split, which mirrors how
 * the keywords are grouped internally:
 *
 *   [Book] – Descriptive – Broad/Phrase   discovery, harvest search terms
 *   [Book] – Titles & Authors – Exact     comparable titles and authors
 *   [Book] – Product Targeting            the ASIN list from the crawl
 *
 * Bids are the ones the scorer already tiered per keyword. The suggested-bid
 * column is left as the app's estimate, not a claim about Amazon's own
 * suggestion — there is no bid API response behind it unless the Ads API
 * source supplied one.
 */

import type { NegativeKeyword } from "./negativeKeywords";
import type { BrandTarget, ProductTarget } from "./productTargets";
import type { MatchType } from "./types";

export const BULKSHEET_COLUMNS = [
  "Product",
  "Entity",
  "Operation",
  "Campaign Name",
  "Ad Group Name",
  "Keyword or Product Targeting",
  "Match Type",
  "Bid",
  "Daily Budget",
  "Campaign Targeting Type",
  "State",
  "Source",
] as const;

export type BulksheetRow = Record<(typeof BULKSHEET_COLUMNS)[number], string>;

export interface ExportKeyword {
  text: string;
  matchType: MatchType;
  bid?: number | null;
  status?: string | null;
  source?: string | null;
  /** "descriptive" | "comp-names" — which ad group the keyword belongs in. */
  group?: "descriptive" | "comp-names";
}

export interface BulksheetInput {
  bookTitle: string;
  keywords: ExportKeyword[];
  negatives?: NegativeKeyword[];
  productTargets?: ProductTarget[];
  brandTargets?: BrandTarget[];
  dailyBudget?: number;
  defaultBid?: number;
}

const PRODUCT = "Sponsored Products";

function campaignName(bookTitle: string, suffix: string): string {
  const title = bookTitle.replace(/[",]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return `${title} – ${suffix}`;
}

function emptyRow(): BulksheetRow {
  return Object.fromEntries(BULKSHEET_COLUMNS.map((column) => [column, ""])) as BulksheetRow;
}

function money(value: number | null | undefined, fallback: number): string {
  const amount = typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return amount.toFixed(2);
}

/** Ads bulk sheets use "enabled"/"paused"; the app's other statuses have no upload meaning. */
function stateFor(status: string | null | undefined): string {
  return status === "paused" ? "paused" : "enabled";
}

/**
 * Builds the full row set: a campaign + ad group header for each group that
 * has content, then its keywords, negatives and targets.
 */
export function buildBulksheetRows(input: BulksheetInput): BulksheetRow[] {
  const { bookTitle, keywords, negatives = [], productTargets = [], brandTargets = [] } = input;
  const dailyBudget = input.dailyBudget ?? 10;
  const defaultBid = input.defaultBid ?? 0.5;
  const rows: BulksheetRow[] = [];

  const descriptive = keywords.filter((keyword) => keyword.group !== "comp-names");
  const compNames = keywords.filter((keyword) => keyword.group === "comp-names");

  const addCampaign = (name: string, targetingType: string) => {
    rows.push({
      ...emptyRow(),
      Product: PRODUCT,
      Entity: "Campaign",
      Operation: "create",
      "Campaign Name": name,
      "Daily Budget": dailyBudget.toFixed(2),
      "Campaign Targeting Type": targetingType,
      State: "enabled",
    });
  };

  const addAdGroup = (campaign: string, adGroup: string) => {
    rows.push({
      ...emptyRow(),
      Product: PRODUCT,
      Entity: "Ad Group",
      Operation: "create",
      "Campaign Name": campaign,
      "Ad Group Name": adGroup,
      Bid: defaultBid.toFixed(2),
      State: "enabled",
    });
  };

  const addKeywordRows = (campaign: string, adGroup: string, entries: ExportKeyword[]) => {
    for (const entry of entries) {
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Keyword",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": adGroup,
        "Keyword or Product Targeting": entry.text,
        "Match Type": entry.matchType,
        Bid: money(entry.bid, defaultBid),
        State: stateFor(entry.status),
        Source: entry.source ?? "",
      });
    }
  };

  if (descriptive.length > 0) {
    const campaign = campaignName(bookTitle, "Descriptive – Broad/Phrase");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "Descriptive");
    addKeywordRows(campaign, "Descriptive", descriptive);

    // Negatives hang off the discovery campaign: that's the one whose broad
    // and phrase matches can drift into them.
    for (const negative of negatives) {
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Negative Keyword",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": "Descriptive",
        "Keyword or Product Targeting": negative.text,
        "Match Type": `negative ${negative.matchType}`,
        State: "enabled",
        Source: negative.reason,
      });
    }
  }

  if (compNames.length > 0) {
    const campaign = campaignName(bookTitle, "Titles & Authors – Exact");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "Comparable titles & authors");
    addKeywordRows(campaign, "Comparable titles & authors", compNames);
  }

  if (productTargets.length > 0 || brandTargets.length > 0) {
    const campaign = campaignName(bookTitle, "Product Targeting");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "ASIN & brand targets");

    for (const target of productTargets) {
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Product Targeting",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": "ASIN & brand targets",
        "Keyword or Product Targeting": `asin="${target.asin}"`,
        Bid: defaultBid.toFixed(2),
        State: "enabled",
        Source: target.title ?? "",
      });
    }

    for (const target of brandTargets) {
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Product Targeting",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": "ASIN & brand targets",
        "Keyword or Product Targeting": `brand="${target.brand}"`,
        Bid: defaultBid.toFixed(2),
        State: "enabled",
        Source: `${target.titles} comparable title${target.titles === 1 ? "" : "s"}`,
      });
    }
  }

  return rows;
}

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Renders rows as CSV, header first. */
export function toCsv(rows: BulksheetRow[]): string {
  const lines = [BULKSHEET_COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(BULKSHEET_COLUMNS.map((column) => escapeCsv(row[column] ?? "")).join(","));
  }
  return lines.join("\n");
}

/** One call from keywords to a downloadable bulksheet CSV. */
export function buildBulksheetCsv(input: BulksheetInput): string {
  return toCsv(buildBulksheetRows(input));
}
