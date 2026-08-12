/**
 * Amazon Ads Search Term Report import (spec §2). Search Term Reports are
 * proven buyer-intent data — real queries that actually served an ad and
 * either converted or didn't — so surviving rows are the highest-trust
 * source in the pipeline (see SOURCE_TIER in lib/keywordCapAndRank.ts).
 */

import { normalize } from "./keywordMerge";
import { KeywordCandidate, MatchType, NegativeSuggestion } from "./types";

/**
 * One normalized row from a Search Term Report CSV/export.
 *
 * `text` is the *customer's* search term (buyer-intent discovery input, used
 * by buildSearchTermReportCandidates below). `campaignName`/`adGroupName`/
 * `targeting`/`matchType` are the *parent target's* identity — the
 * keyword/product-target that actually served the ad and matched this
 * search term — captured for campaigns spec §5's performance rollup
 * (lib/resultsMatching.ts). A report always has both; this parser
 * previously discarded the parent identity entirely.
 */
export interface SearchTermReportRow {
  text: string;
  clicks: number;
  orders: number;
  cost: number;
  /** Advertising cost of sale, 0-1 (e.g. 0.25 = 25%). */
  acos: number;
  campaignName?: string;
  adGroupName?: string;
  /** The keyword text or targeting expression that matched (Amazon's "Targeting" column) — not the customer's search term. */
  targeting?: string;
  matchType?: MatchType;
  impressions?: number;
  sales?: number;
}

/** Minimum orders for a search term to be trusted as a buyer-intent keyword. */
export const MIN_ORDERS_FOR_KEEP = 2;
/** Maximum ACOS (as a 0-1 fraction) for a search term to be trusted. */
export const MAX_ACOS_FOR_KEEP = 0.3;
/** Spend threshold (in the report's currency) above which a zero-order term is worth a negative suggestion. */
export const MIN_SPEND_FOR_NEGATIVE = 5;

/**
 * Normalizes raw CSV rows (however the report's column names/casing come in)
 * into the shape the rest of this module expects. Accepts loosely-typed
 * records since Search Term Report exports vary between Seller Central,
 * Vendor Central, and third-party tools.
 */
export function parseSearchTermReportRows(
  rawRows: Array<Record<string, unknown>>
): SearchTermReportRow[] {
  const pick = (row: Record<string, unknown>, keys: string[]): unknown => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
    }
    return undefined;
  };
  const toNumber = (value: unknown): number => {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    if (typeof value === "string") {
      const cleaned = value.replace(/[%$,]/g, "").trim();
      const num = parseFloat(cleaned);
      if (!Number.isFinite(num)) return 0;
      // A percentage-formatted ACOS ("25%") parses to 25, not 0.25.
      return value.includes("%") ? num / 100 : num;
    }
    return 0;
  };

  const pickString = (row: Record<string, unknown>, keys: string[]): string | undefined => {
    const value = pick(row, keys);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  const toMatchType = (value: string | undefined): MatchType | undefined => {
    if (!value) return undefined;
    const lower = value.toLowerCase();
    return lower === "exact" || lower === "phrase" || lower === "broad" ? lower : undefined;
  };

  const rows: SearchTermReportRow[] = [];
  for (const raw of rawRows) {
    const text = pick(raw, ["Customer Search Term", "Search Term", "text", "searchTerm", "query"]);
    if (typeof text !== "string" || !text.trim()) continue;

    rows.push({
      text: normalize(text),
      clicks: toNumber(pick(raw, ["Clicks", "clicks"])),
      orders: toNumber(pick(raw, ["7 Day Total Orders (#)", "Orders", "orders"])),
      cost: toNumber(pick(raw, ["Spend", "Cost", "cost"])),
      acos: toNumber(pick(raw, ["ACOS", "Acos", "acos", "7 Day Advertising Cost of Sales (ACOS)"])),
      campaignName: pickString(raw, ["Campaign Name", "campaignName"]),
      adGroupName: pickString(raw, ["Ad Group Name", "adGroupName"]),
      targeting: pickString(raw, ["Targeting", "targeting"]),
      matchType: toMatchType(pickString(raw, ["Match Type", "matchType"])),
      impressions: toNumber(pick(raw, ["Impressions", "impressions"])),
      sales: toNumber(pick(raw, ["7 Day Total Sales", "Sales", "sales"])),
    });
  }
  return rows;
}

/**
 * Builds high-intent keyword candidates from Search Term Report rows that
 * cleared the buyer-intent bar (orders >= MIN_ORDERS_FOR_KEEP, ACOS <=
 * MAX_ACOS_FOR_KEEP), and collects the rows that spent money with zero
 * orders into negative suggestions.
 */
export function buildSearchTermReportCandidates(
  book: { title?: string; author?: string },
  reportData: SearchTermReportRow[],
  options: { minOrders?: number; maxAcos?: number; minSpendForNegative?: number } = {}
): { candidates: KeywordCandidate[]; negativeSuggestions: NegativeSuggestion[] } {
  void book;
  const minOrders = options.minOrders ?? MIN_ORDERS_FOR_KEEP;
  const maxAcos = options.maxAcos ?? MAX_ACOS_FOR_KEEP;
  const minSpendForNegative = options.minSpendForNegative ?? MIN_SPEND_FOR_NEGATIVE;

  const kept = reportData.filter((row) => row.orders >= minOrders && row.acos <= maxAcos && row.acos >= 0);
  const avgCpc =
    kept.length > 0 && kept.some((r) => r.clicks > 0)
      ? kept.reduce((sum, r) => sum + (r.clicks > 0 ? r.cost / r.clicks : 0), 0) /
        kept.filter((r) => r.clicks > 0).length
      : 0.5;

  const candidates: KeywordCandidate[] = kept.map((row) => ({
    text: row.text,
    sources: ["search-term-report"],
    category: "core-genre",
    intentSegment: "alpha-core",
    matchType: "exact",
    specificity: row.orders >= 5 ? 5 : 4,
    suggestedBid: Math.round((avgCpc * 1.1 + Number.EPSILON) * 100) / 100,
    clicks: row.clicks,
    orders: row.orders,
    cost: row.cost,
    acos: row.acos,
  }));

  const negativeSuggestions: NegativeSuggestion[] = reportData
    .filter((row) => row.orders === 0 && row.cost >= minSpendForNegative)
    .map((row) => ({
      text: row.text,
      matchType: "exact",
      reasonCode: "ZERO_ORDER_SPEND",
      reason: `Spent ${row.cost.toFixed(2)} with 0 orders across ${row.clicks} clicks`,
      source: "search-term-report",
    }));

  return { candidates, negativeSuggestions };
}
