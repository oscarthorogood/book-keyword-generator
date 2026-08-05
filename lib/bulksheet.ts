import ExcelJS from "exceljs";
import { GenerateRequest, KeywordCandidate, MatchType } from "./types";

/**
 * Column layout for the Sponsored Products bulk operations sheet.
 *
 * ASSUMPTION FLAGGED IN THE BUILD PLAN: this reflects Amazon's documented
 * Sponsored Products Bulksheet schema (Campaign / Ad Group / Product Ad /
 * Keyword rows, joined by Campaign Name + Ad Group Name text when creating
 * new entities). Amazon revises this schema periodically. Before relying on
 * this for a real upload, download a fresh template from Campaign
 * Manager > Bulk Operations and diff its header row against COLUMNS below.
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
  "Bidding Strategy",
] as const;

type ColumnName = (typeof COLUMNS)[number];
type Row = Partial<Record<ColumnName, string | number>>;

const MATCH_TYPE_LABEL: Record<MatchType, string> = {
  broad: "Broad",
  phrase: "Phrase",
  exact: "Exact",
};

function formatDate(isoDate: string): string {
  // Bulksheet expects MM/DD/YYYY.
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

export async function buildBulksheet(
  request: GenerateRequest,
  keywords: KeywordCandidate[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sponsored Products Campaigns");

  sheet.columns = COLUMNS.map((header) => ({ header, key: header, width: 22 }));

  const rows: Row[] = [];

  rows.push({
    Product: "Sponsored Products",
    Entity: "Campaign",
    Operation: "Create",
    "Campaign Name": request.campaignName,
    "Start Date": formatDate(request.startDate),
    "Targeting Type": "Manual",
    State: "enabled",
    "Daily Budget": request.dailyBudget,
    "Bidding Strategy": "Dynamic bids - down only",
  });

  rows.push({
    Product: "Sponsored Products",
    Entity: "Ad Group",
    Operation: "Create",
    "Campaign Name": request.campaignName,
    "Ad Group Name": request.adGroupName,
    State: "enabled",
    "Ad Group Default Bid": request.defaultBid,
  });

  rows.push({
    Product: "Sponsored Products",
    Entity: "Product Ad",
    Operation: "Create",
    "Campaign Name": request.campaignName,
    "Ad Group Name": request.adGroupName,
    State: "enabled",
    ASIN: request.asin,
  });

  for (const keyword of keywords) {
    for (const matchType of request.matchTypes) {
      rows.push({
        Product: "Sponsored Products",
        Entity: "Keyword",
        Operation: "Create",
        "Campaign Name": request.campaignName,
        "Ad Group Name": request.adGroupName,
        State: "enabled",
        "Keyword Text": keyword.text,
        "Match Type": MATCH_TYPE_LABEL[matchType],
        Bid: keyword.suggestedBid ?? request.defaultBid,
      });
    }
  }

  sheet.addRows(rows);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
