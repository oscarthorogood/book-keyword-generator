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

// --- Upload row contract (campaigns spec §1.1/§8 PR 3) ---
//
// Amazon rejects the review CSV's shape outright: no `Product Ad` row (so
// there's nothing to advertise), a custom `Source` column it doesn't
// recognise, `Operation` written lowercase, and negative match types written
// as `"negative exact"` instead of `negativeExact`. This is the corrected
// column set and row builders for the `*-upload.xlsx` output — the
// `*-review.csv` output (lib/bulksheet.ts's `buildBulksheetRows`) is
// untouched and keeps its existing shape as the human-readable audit trail.
//
// This is a minimal, named-bug fix, not a claim of full Amazon bulk template
// parity — the real template has many more columns (Portfolio Id, several
// informational-only readback columns, etc.) this app doesn't model. Treat
// it as unverified until the PR 3.5 human upload gate confirms it.

export type Entity = "Campaign" | "Ad Group" | "Product Ad" | "Keyword" | "Product Targeting" | "Negative Keyword";
export type Operation = "Create" | "Update" | "Archive";

export const BULKSHEET_UPLOAD_COLUMNS = [
  "Product",
  "Entity",
  "Operation",
  "Campaign Name",
  "Ad Group Name",
  "SKU",
  "Keyword or Product Targeting",
  "Match Type",
  "Bid",
  "Daily Budget",
  "Campaign Targeting Type",
  "State",
] as const;

export type UploadRow = Record<(typeof BULKSHEET_UPLOAD_COLUMNS)[number], string>;

function emptyUploadRow(): UploadRow {
  return Object.fromEntries(BULKSHEET_UPLOAD_COLUMNS.map((column) => [column, ""])) as UploadRow;
}

/** Amazon's negative-keyword match type codes: camelCase, no space. Sponsored Products has no negative broad. */
export function negativeMatchTypeCode(matchType: NegativeKeyword["matchType"]): "negativePhrase" | "negativeExact" {
  return matchType === "exact" ? "negativeExact" : "negativePhrase";
}

export function buildUploadCampaignRow(params: { name: string; dailyBudget: number; targetingType: string }): UploadRow {
  return {
    ...emptyUploadRow(),
    Product: PRODUCT,
    Entity: "Campaign",
    Operation: "Create",
    "Campaign Name": params.name,
    "Daily Budget": params.dailyBudget.toFixed(2),
    "Campaign Targeting Type": params.targetingType,
    State: "enabled",
  };
}

export function buildUploadAdGroupRow(params: {
  campaign: string;
  adGroup: string;
  bid: number;
  fallbackBid?: number;
}): UploadRow {
  return {
    ...emptyUploadRow(),
    Product: PRODUCT,
    Entity: "Ad Group",
    Operation: "Create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    Bid: money(params.bid, params.fallbackBid ?? params.bid),
    State: "enabled",
  };
}

/** One per ad group: the entity that actually names what's being advertised. Without it Amazon has nothing to serve ads for. */
export function buildProductAdRow(params: { campaign: string; adGroup: string; sku: string }): UploadRow {
  return {
    ...emptyUploadRow(),
    Product: PRODUCT,
    Entity: "Product Ad",
    Operation: "Create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    SKU: params.sku,
    State: "enabled",
  };
}

export function buildUploadKeywordRow(params: {
  campaign: string;
  adGroup: string;
  text: string;
  matchType: MatchType;
  bid: number | null | undefined;
  defaultBid: number;
  status?: string | null;
}): UploadRow {
  return {
    ...emptyUploadRow(),
    Product: PRODUCT,
    Entity: "Keyword",
    Operation: "Create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    "Keyword or Product Targeting": params.text,
    "Match Type": params.matchType,
    Bid: money(params.bid, params.defaultBid),
    State: stateFor(params.status),
  };
}

export function buildUploadNegativeKeywordRow(params: {
  campaign: string;
  adGroup: string;
  text: string;
  matchType: NegativeKeyword["matchType"];
}): UploadRow {
  return {
    ...emptyUploadRow(),
    Product: PRODUCT,
    Entity: "Negative Keyword",
    Operation: "Create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    "Keyword or Product Targeting": params.text,
    "Match Type": negativeMatchTypeCode(params.matchType),
    State: "enabled",
  };
}

export function buildUploadProductTargetingRow(params: {
  campaign: string;
  adGroup: string;
  targetingExpression: string;
  bid: number;
  fallbackBid?: number;
}): UploadRow {
  return {
    ...emptyUploadRow(),
    Product: PRODUCT,
    Entity: "Product Targeting",
    Operation: "Create",
    "Campaign Name": params.campaign,
    "Ad Group Name": params.adGroup,
    "Keyword or Product Targeting": params.targetingExpression,
    Bid: params.fallbackBid === undefined ? params.bid.toFixed(2) : money(params.bid, params.fallbackBid),
    State: "enabled",
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
