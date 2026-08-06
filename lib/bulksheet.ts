import ExcelJS from "exceljs";
import { MATCH_TYPE_BID_MULTIPLIER } from "./bidding";
import { CampaignType, KeywordCandidate, MatchType, ProductTargetCandidate } from "./types";

/**
 * Column layout for the Sponsored Products bulk operations sheet.
 *
 * ASSUMPTION FLAGGED IN THE BUILD PLAN: this reflects Amazon's documented
 * Sponsored Products Bulksheet schema (Campaign / Ad Group / Product Ad /
 * Keyword / Product Targeting / Campaign Negative Keyword rows, joined by
 * Campaign Name + Ad Group Name text when creating new entities). Amazon revises this
 * schema periodically. Before relying on this for a real upload, download a
 * fresh template from Campaign Manager > Bulk Operations and diff its header
 * row against COLUMNS below.
 */
const COLUMNS = [
  "Product",
  "Entity",
  "Operation",
  "Campaign ID",
  "Ad Group ID",
  "Portfolio ID",
  "Ad ID",
  "Keyword ID",
  "Product Targeting ID",
  "Campaign Name",
  "Ad Group Name",
  "Start Date",
  "End Date",
  "Targeting Type",
  "State",
  "Daily Budget",
  "SKU",
  "ASIN",
  "Ad Group Default Bid",
  "Bid",
  "Keyword Text",
  "Match Type",
  "Product Targeting Expression",
  "Bidding Strategy",
] as const;

type ColumnName = (typeof COLUMNS)[number];
type Row = Partial<Record<ColumnName, string | number>>;

const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  broad: "Broad",
  phrase: "Phrase",
  exact: "Exact",
};

/**
 * Amazon's four default Auto-campaign targeting clauses, in the order the
 * learnings doc's search-term data shows them (`close-match` was the most
 * common `Targeting` value, `complements` the least). Bid multipliers mirror
 * the same "bid up on high-confidence, down on exploratory" logic the doc
 * calls for on the Manual side: close-match (near-identical query intent)
 * gets the full CPC ceiling, complements (a browse/comparison signal, not a
 * query match at all) gets the deepest discount.
 */
export const AUTO_TARGETING_CLAUSES = [
  { expression: "close-match", multiplier: 1 },
  { expression: "loose-match", multiplier: 0.85 },
  { expression: "substitutes", multiplier: 0.7 },
  { expression: "complements", multiplier: 0.6 },
] as const;

function formatDate(isoDate: string): string {
  // Bulksheet expects MM/DD/YYYY.
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

/**
 * One Ad Group within a Manual (SPM) campaign. The research blueprint
 * (section 5) recommends tracking tropes/themes, comp author/title names,
 * and ASIN product targeting as separate campaigns for clean performance
 * attribution; this app keeps them as separate Ad Groups under one campaign
 * instead, so the naming convention's fixed field count isn't affected by
 * which categories a given book happens to have data for.
 */
export interface SpmAdGroup {
  name: string;
  /** This ad group's own default bid (baseBid scaled by AD_GROUP_BID_MULTIPLIER — see lib/bidding.ts). */
  defaultBid: number;
  /** Keyword rows for this ad group, if any. */
  keywords?: KeywordCandidate[];
  /** Match types to write for every keyword above (ignored if keywords is empty). */
  matchTypes?: MatchType[];
  /** Product Targeting rows for this ad group, if any. */
  productTargets?: ProductTargetCandidate[];
}

export interface BulksheetInput {
  campaignName: string;
  asin: string;
  campaignType: CampaignType;
  dailyBudget: number;
  startDate: string;
  /** Base CPC ceiling (from RRP-derived bid economics, or a manual override) everything else scales off of. */
  baseBid: number;
  /** Auto (SPA) only — defaults to "Auto Targeting". */
  autoAdGroupName?: string;
  /** Manual (SPM) only. Ad groups with neither keywords nor product targets are skipped. */
  adGroups?: SpmAdGroup[];
  /** Manual (SPM) only. Written as Campaign Negative Keyword rows (no Ad Group Name) so they suppress spend across every ad group in the campaign. */
  negativeKeywords?: string[];
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildBulksheet(input: BulksheetInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sponsored Products Campaigns");

  sheet.columns = COLUMNS.map((header) => ({ header, key: header, width: 24 }));

  const rows: Row[] = [];
  const isAuto = input.campaignType === "SPA";

  rows.push({
    Product: "Sponsored Products",
    Entity: "Campaign",
    Operation: "Create",
    "Campaign Name": input.campaignName,
    "Start Date": formatDate(input.startDate),
    "Targeting Type": isAuto ? "Auto" : "Manual",
    State: "enabled",
    "Daily Budget": input.dailyBudget,
    "Bidding Strategy": "Dynamic bids - down only",
  });

  if (isAuto) {
    const adGroupName = input.autoAdGroupName ?? "Auto Targeting";

    rows.push({
      Product: "Sponsored Products",
      Entity: "Ad Group",
      Operation: "Create",
      "Campaign Name": input.campaignName,
      "Ad Group Name": adGroupName,
      State: "enabled",
      "Ad Group Default Bid": input.baseBid,
    });
    rows.push({
      Product: "Sponsored Products",
      Entity: "Product Ad",
      Operation: "Create",
      "Campaign Name": input.campaignName,
      "Ad Group Name": adGroupName,
      State: "enabled",
      ASIN: input.asin,
    });

    // Auto campaigns don't take keyword/product-target rows — Amazon's own
    // engine decides what to match. The only thing worth expressing per
    // clause is a bid, so each of the 4 default targeting groups gets its
    // own Product Targeting row purely to set a differentiated bid.
    for (const clause of AUTO_TARGETING_CLAUSES) {
      rows.push({
        Product: "Sponsored Products",
        Entity: "Product Targeting",
        Operation: "Create",
        "Campaign Name": input.campaignName,
        "Ad Group Name": adGroupName,
        State: "enabled",
        Bid: round2(input.baseBid * clause.multiplier),
        "Product Targeting Expression": clause.expression,
      });
    }
  } else {
    for (const adGroup of input.adGroups ?? []) {
      const hasKeywords = (adGroup.keywords?.length ?? 0) > 0;
      const hasProductTargets = (adGroup.productTargets?.length ?? 0) > 0;
      if (!hasKeywords && !hasProductTargets) continue;

      rows.push({
        Product: "Sponsored Products",
        Entity: "Ad Group",
        Operation: "Create",
        "Campaign Name": input.campaignName,
        "Ad Group Name": adGroup.name,
        State: "enabled",
        "Ad Group Default Bid": adGroup.defaultBid,
      });
      // Each ad group advertising this ASIN needs its own Product Ad row —
      // Product Ad is scoped to Campaign + Ad Group + ASIN, not just ASIN.
      rows.push({
        Product: "Sponsored Products",
        Entity: "Product Ad",
        Operation: "Create",
        "Campaign Name": input.campaignName,
        "Ad Group Name": adGroup.name,
        State: "enabled",
        ASIN: input.asin,
      });

      for (const keyword of adGroup.keywords ?? []) {
        for (const matchType of adGroup.matchTypes ?? []) {
          const bid = keyword.suggestedBid ?? adGroup.defaultBid;
          rows.push({
            Product: "Sponsored Products",
            Entity: "Keyword",
            Operation: "Create",
            "Campaign Name": input.campaignName,
            "Ad Group Name": adGroup.name,
            State: "enabled",
            "Keyword Text": keyword.text,
            "Match Type": MATCH_TYPE_LABEL[matchType],
            Bid: round2(bid * MATCH_TYPE_BID_MULTIPLIER[matchType]),
          });
        }
      }

      for (const target of adGroup.productTargets ?? []) {
        rows.push({
          Product: "Sponsored Products",
          Entity: "Product Targeting",
          Operation: "Create",
          "Campaign Name": input.campaignName,
          "Ad Group Name": adGroup.name,
          State: "enabled",
          Bid: round2(target.suggestedBid ?? adGroup.defaultBid),
          "Product Targeting Expression": `asin="${target.asin}"`,
        });
      }
    }

    for (const negative of input.negativeKeywords ?? []) {
      rows.push({
        Product: "Sponsored Products",
        Entity: "Campaign Negative Keyword",
        Operation: "Create",
        "Campaign Name": input.campaignName,
        State: "enabled",
        "Keyword Text": negative,
        "Match Type": "Negative Exact",
      });
    }
  }

  sheet.addRows(rows);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
