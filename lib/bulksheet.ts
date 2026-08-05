import ExcelJS from "exceljs";
import { MATCH_TYPE_BID_MULTIPLIER } from "./bidding";
import { CampaignType, KeywordCandidate, MatchType, ProductTargetCandidate } from "./types";

/**
 * Column layout for the Sponsored Products bulk operations sheet.
 *
 * ASSUMPTION FLAGGED IN THE BUILD PLAN: this reflects Amazon's documented
 * Sponsored Products Bulksheet schema (Campaign / Ad Group / Product Ad /
 * Keyword / Product Targeting / Negative Keyword rows, joined by Campaign
 * Name + Ad Group Name text when creating new entities). Amazon revises this
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

export interface BulksheetInput {
  campaignName: string;
  adGroupName: string;
  asin: string;
  campaignType: CampaignType;
  dailyBudget: number;
  startDate: string;
  /** Base CPC ceiling (from RRP-derived bid economics, or a manual override) that match-type/clause multipliers scale off of. */
  baseBid: number;
  /** Manual (SPM) only. */
  matchTypes?: MatchType[];
  keywords?: KeywordCandidate[];
  productTargets?: ProductTargetCandidate[];
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

  rows.push({
    Product: "Sponsored Products",
    Entity: "Ad Group",
    Operation: "Create",
    "Campaign Name": input.campaignName,
    "Ad Group Name": input.adGroupName,
    State: "enabled",
    "Ad Group Default Bid": input.baseBid,
  });

  rows.push({
    Product: "Sponsored Products",
    Entity: "Product Ad",
    Operation: "Create",
    "Campaign Name": input.campaignName,
    "Ad Group Name": input.adGroupName,
    State: "enabled",
    ASIN: input.asin,
  });

  if (isAuto) {
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
        "Ad Group Name": input.adGroupName,
        State: "enabled",
        Bid: round2(input.baseBid * clause.multiplier),
        "Product Targeting Expression": clause.expression,
      });
    }
  } else {
    for (const keyword of input.keywords ?? []) {
      for (const matchType of input.matchTypes ?? []) {
        const bid = keyword.suggestedBid ?? input.baseBid;
        rows.push({
          Product: "Sponsored Products",
          Entity: "Keyword",
          Operation: "Create",
          "Campaign Name": input.campaignName,
          "Ad Group Name": input.adGroupName,
          State: "enabled",
          "Keyword Text": keyword.text,
          "Match Type": MATCH_TYPE_LABEL[matchType],
          Bid: round2(bid * MATCH_TYPE_BID_MULTIPLIER[matchType]),
        });
      }
    }

    for (const target of input.productTargets ?? []) {
      rows.push({
        Product: "Sponsored Products",
        Entity: "Product Targeting",
        Operation: "Create",
        "Campaign Name": input.campaignName,
        "Ad Group Name": input.adGroupName,
        State: "enabled",
        Bid: round2(target.suggestedBid ?? input.baseBid),
        "Product Targeting Expression": `asin="${target.asin}"`,
      });
    }

    for (const negative of input.negativeKeywords ?? []) {
      rows.push({
        Product: "Sponsored Products",
        Entity: "Negative Keyword",
        Operation: "Create",
        "Campaign Name": input.campaignName,
        "Ad Group Name": input.adGroupName,
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
