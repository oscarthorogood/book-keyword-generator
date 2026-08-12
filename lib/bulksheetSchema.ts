/**
 * Amazon Ads bulk-upload column contract (campaigns spec §8 PR 2).
 *
 * Single source of truth for the bulksheet's shape — the column list, the
 * row type, and one pure builder per entity type — so nothing downstream
 * (Create, Update, the future diff) hardcodes a column name or row shape of
 * its own. Promoted verbatim from `lib/bulksheet.ts`; no behaviour change.
 */

import type { NegativeKeyword } from "./negativeKeywords";
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

export const PRODUCT = "Sponsored Products";

export function emptyRow(): BulksheetRow {
  return Object.fromEntries(BULKSHEET_COLUMNS.map((column) => [column, ""])) as BulksheetRow;
}

/** Formats a bid, falling back when the value is missing/non-positive. */
export function money(value: number | null | undefined, fallback: number): string {
  const amount =
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
  return amount.toFixed(2);
}

/** Ads bulk sheets use "enabled"/"paused"; the app's other statuses have no upload meaning. */
export function stateFor(status: string | null | undefined): string {
  return status === "paused" ? "paused" : "enabled";
}

export function buildCampaignRow(params: {
  name: string;
  dailyBudget: number;
  targetingType: string;
}): BulksheetRow {
  return {
    ...emptyRow(),
    Product: PRODUCT,
    Entity: "Campaign",
    Operation: "create",
    "Campaign Name": params.name,
    "Daily Budget": params.dailyBudget.toFixed(2),
    "Campaign Targeting Type": params.targetingType,
    State: "enabled",
  };
}

export function buildAdGroupRow(params: {
  campaign: string;
  adGroup: string;
  bid: number;
  /** Falls back to this (via `money()`) when `bid` is missing/non-positive. Defaults to `bid` itself, i.e. a plain `.toFixed(2)`. */
  fallbackBid?: number;
}): BulksheetRow {
  return {
    ...emptyRow(),
    Product: PRODUCT,
    Entity: "Ad Group",
    Operation: "create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    Bid: money(params.bid, params.fallbackBid ?? params.bid),
    State: "enabled",
  };
}

export function buildKeywordRow(params: {
  campaign: string;
  adGroup: string;
  text: string;
  matchType: MatchType;
  bid: number | null | undefined;
  defaultBid: number;
  status?: string | null;
  source?: string | null;
}): BulksheetRow {
  return {
    ...emptyRow(),
    Product: PRODUCT,
    Entity: "Keyword",
    Operation: "create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    "Keyword or Product Targeting": params.text,
    "Match Type": params.matchType,
    Bid: money(params.bid, params.defaultBid),
    State: stateFor(params.status),
    Source: params.source ?? "",
  };
}

export function buildNegativeKeywordRow(params: {
  campaign: string;
  adGroup: string;
  text: string;
  matchType: NegativeKeyword["matchType"];
  reason: string;
}): BulksheetRow {
  return {
    ...emptyRow(),
    Product: PRODUCT,
    Entity: "Negative Keyword",
    Operation: "create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    "Keyword or Product Targeting": params.text,
    "Match Type": `negative ${params.matchType}`,
    State: "enabled",
    Source: params.reason,
  };
}

export function buildProductTargetingRow(params: {
  campaign: string;
  adGroup: string;
  targetingExpression: string;
  bid: number;
  /** Falls back to this (via `money()`) when `bid` is missing/non-positive. Omit for a plain `.toFixed(2)`. */
  fallbackBid?: number;
  source?: string;
}): BulksheetRow {
  return {
    ...emptyRow(),
    Product: PRODUCT,
    Entity: "Product Targeting",
    Operation: "create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    "Keyword or Product Targeting": params.targetingExpression,
    Bid:
      params.fallbackBid === undefined
        ? params.bid.toFixed(2)
        : money(params.bid, params.fallbackBid),
    State: "enabled",
    Source: params.source ?? "",
  };
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
