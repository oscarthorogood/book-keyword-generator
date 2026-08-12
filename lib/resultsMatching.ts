/**
 * Aggregates Search Term Report rows up to their parent target and matches
 * them back to this book's campaigns/keywords/ASINs (campaigns spec §5).
 * Pure — no I/O; the caller (app/api/books/[id]/results/import/route.ts,
 * PR 8b) pre-loads the lookup maps once and does the actual DB writes.
 */

import { normalizeKeyword } from "./keywordFilters";
import type { SearchTermReportRow } from "./searchTermImport";
import type { MatchType } from "./types";

/** One row per (campaign, ad group, targeting, match type) — the parent target Amazon actually bid on, not the individual customer search terms that matched it. */
export interface AggregatedResultRow {
  campaignName: string | null;
  adGroupName: string | null;
  /** The keyword text or targeting expression that matched (Amazon's "Targeting" column). */
  targeting: string | null;
  matchType: MatchType | null;
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
}

/**
 * Rolls many search-term rows up to one row per parent target. A report
 * commonly has dozens of customer search terms all matching the same
 * keyword/ad group; the performance rollup cares about the target's totals,
 * not each individual query.
 */
export function aggregateByTarget(rows: SearchTermReportRow[]): AggregatedResultRow[] {
  const byKey = new Map<string, AggregatedResultRow>();

  for (const row of rows) {
    const key = [row.campaignName ?? "", row.adGroupName ?? "", row.targeting ?? "", row.matchType ?? ""].join("::");
    const existing = byKey.get(key);
    if (existing) {
      existing.impressions += row.impressions ?? 0;
      existing.clicks += row.clicks;
      existing.spend += row.cost;
      existing.sales += row.sales ?? 0;
      existing.orders += row.orders;
    } else {
      byKey.set(key, {
        campaignName: row.campaignName ?? null,
        adGroupName: row.adGroupName ?? null,
        targeting: row.targeting ?? null,
        matchType: row.matchType ?? null,
        impressions: row.impressions ?? 0,
        clicks: row.clicks,
        spend: row.cost,
        sales: row.sales ?? 0,
        orders: row.orders,
      });
    }
  }

  return Array.from(byKey.values());
}

export interface MatchContext {
  /** Keyed by `${normalizeKeyword(text)}::${matchType}` — keywords by (book_id, text, match_type), per spec §5. */
  keywordsByTextAndMatchType: Map<string, string>;
  /** Keyed by uppercased ASIN. */
  competitorAsinsByAsin: Map<string, string>;
  /** Keyed by exact campaign name — safe because campaigns.unique_name_per_user (sql/21) rules out collisions. */
  campaignsByName: Map<string, string>;
}

export interface MatchedResultRow extends AggregatedResultRow {
  campaignId: string | null;
  keywordId: string | null;
  competitorAsinId: string | null;
}

const ASIN_TARGETING_PATTERN = /asin="?([A-Z0-9]{10})"?/i;

/** Extracts the ASIN from a product-targeting expression like `asin="B0EXAMPLE1"`, if this row is one. */
function extractAsin(targeting: string | null): string | null {
  if (!targeting) return null;
  const match = ASIN_TARGETING_PATTERN.exec(targeting);
  return match ? match[1].toUpperCase() : null;
}

/** BMM keywords export with a '+' on every word (toModifiedBroadSyntax); the underlying keyword row's text never has one. */
function stripBmmPrefixes(text: string): string {
  return text.replace(/\+/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Matches each aggregated row to a campaign (by exact name), and to either a
 * keyword (by normalized text + match type) or a competitor ASIN (by ASIN
 * parsed out of the targeting expression). Each match is independent — a row
 * can match a campaign without matching a keyword/ASIN, e.g. the campaign
 * was renamed in Amazon but the target text wasn't touched.
 */
export function matchResultRows(
  rows: AggregatedResultRow[],
  context: MatchContext
): { matched: MatchedResultRow[]; unmatchedCount: number } {
  let unmatchedCount = 0;

  const matched = rows.map((row) => {
    const campaignId = row.campaignName ? (context.campaignsByName.get(row.campaignName) ?? null) : null;

    const asin = extractAsin(row.targeting);
    const competitorAsinId = asin ? (context.competitorAsinsByAsin.get(asin) ?? null) : null;

    let keywordId: string | null = null;
    if (!asin && row.targeting && row.matchType) {
      const key = `${normalizeKeyword(stripBmmPrefixes(row.targeting))}::${row.matchType}`;
      keywordId = context.keywordsByTextAndMatchType.get(key) ?? null;
    }

    if (!keywordId && !competitorAsinId) unmatchedCount += 1;

    return { ...row, campaignId, keywordId, competitorAsinId };
  });

  return { matched, unmatchedCount };
}
