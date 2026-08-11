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

/**
 * Manual campaigns default to $100/day (brief F11): the $10 default this
 * generator previously emitted was a config bug, not an intended budget.
 */
const DEFAULT_MANUAL_DAILY_BUDGET = 100;

/**
 * Auto campaigns are the discovery engine that feeds search-term
 * harvesting. At the old 5%-of-$10 default this worked out to a hardcoded
 * $1/day floor — ~2 clicks/day, which discovers almost nothing (brief F11).
 * ~10% of the manual budget is a more useful default at any budget size.
 */
const AUTO_BUDGET_RATIO = 0.1;
const AUTO_BUDGET_MIN = 1;

/** Close > substitutes > loose > complements: closer matches earn the higher bid. */
const AUTO_TARGETING_GROUPS: Array<{ expression: string; label: string; bidMultiplier: number }> = [
  { expression: "close-match", label: "Auto: close match", bidMultiplier: 1 },
  { expression: "substitutes", label: "Auto: substitutes", bidMultiplier: 0.8 },
  { expression: "loose-match", label: "Auto: loose match", bidMultiplier: 0.6 },
  { expression: "complements", label: "Auto: complements", bidMultiplier: 0.4 },
];

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
  const dailyBudget = input.dailyBudget ?? DEFAULT_MANUAL_DAILY_BUDGET;
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

  // §23.7: negatives previously only shipped in the Descriptive campaign,
  // so the Exact and Product Targeting campaigns had no protection from
  // known-bad queries. Every campaign type accepts negative keywords for
  // query exclusion (product-targeting campaigns included), so every
  // campaign this run creates gets the same negative list.
  const addNegativeRows = (campaign: string, adGroup: string) => {
    for (const negative of negatives) {
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Negative Keyword",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": adGroup,
        "Keyword or Product Targeting": negative.text,
        "Match Type": `negative ${negative.matchType}`,
        State: "enabled",
        Source: negative.reason,
      });
    }
  };

  if (descriptive.length > 0) {
    const campaign = campaignName(bookTitle, "Descriptive – Broad/Phrase");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "Descriptive");
    addKeywordRows(campaign, "Descriptive", descriptive);
    addNegativeRows(campaign, "Descriptive");
  }

  if (compNames.length > 0) {
    const campaign = campaignName(bookTitle, "Titles & Authors – Exact");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "Comparable titles & authors");
    addKeywordRows(campaign, "Comparable titles & authors", compNames);
    addNegativeRows(campaign, "Comparable titles & authors");
  }

  // §17: the auto campaign is the discovery engine that feeds
  // search-term harvesting (§6) — runs alongside the manual campaigns
  // above, at a small slice of the budget, seeded with the same
  // campaign-level negatives so discovery spend isn't wasted on known junk.
  // No Ads API involved: this is bulksheet-only, same as everything else here.
  if (descriptive.length > 0 || compNames.length > 0) {
    const campaign = campaignName(bookTitle, "Auto Discovery");
    const autoBudget = Math.max(AUTO_BUDGET_MIN, Math.round(dailyBudget * AUTO_BUDGET_RATIO * 100) / 100);
    rows.push({
      ...emptyRow(),
      Product: PRODUCT,
      Entity: "Campaign",
      Operation: "create",
      "Campaign Name": campaign,
      "Daily Budget": autoBudget.toFixed(2),
      "Campaign Targeting Type": "auto",
      State: "enabled",
    });
    for (const group of AUTO_TARGETING_GROUPS) {
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Ad Group",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": group.label,
        Bid: money(defaultBid * group.bidMultiplier, defaultBid),
        State: "enabled",
      });
      rows.push({
        ...emptyRow(),
        Product: PRODUCT,
        Entity: "Product Targeting",
        Operation: "create",
        "Campaign Name": campaign,
        "Ad Group Name": group.label,
        "Keyword or Product Targeting": `targetingExpression="${group.expression}"`,
        Bid: money(defaultBid * group.bidMultiplier, defaultBid),
        State: "enabled",
        Source: "auto",
      });
    }
    addNegativeRows(campaign, AUTO_TARGETING_GROUPS[0].label);
  }

  if (productTargets.length > 0 || brandTargets.length > 0) {
    const campaign = campaignName(bookTitle, "Product Targeting");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "ASIN & brand targets");
    addNegativeRows(campaign, "ASIN & brand targets");

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
