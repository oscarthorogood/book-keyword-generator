import ExcelJS from "exceljs";
import { isValidProductAsin } from "./asinValidation";
import { MATCH_TYPE_BID_MULTIPLIER } from "./bidding";
import { KeywordCandidate, MatchType, ProductTargetCandidate } from "./types";

/**
 * Column layout for the Sponsored Products bulk operations sheet.
 *
 * ASSUMPTION FLAGGED IN THE BUILD PLAN: this reflects Amazon's documented
 * Sponsored Products Bulksheet schema (Campaign / Ad Group / Product Ad /
 * Keyword / Product Targeting rows, joined by Campaign Name + Ad Group Name
 * text when creating new entities). Amazon revises this schema periodically.
 * Before relying on this for a real upload, download a fresh template from
 * Campaign Manager > Bulk Operations and diff its header row against
 * COLUMNS below.
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

function formatDate(isoDate: string): string {
  // Bulksheet expects MM/DD/YYYY.
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

/**
 * One Ad Group within the Manual campaign. The research blueprint (section
 * 5) recommends tracking tropes/themes, comp author/title names, and ASIN
 * product targeting as separate campaigns for clean performance
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
  campaignId?: string;
  asin: string;
  author?: string;
  bookTitle?: string;
  seriesName?: string;
  seriesOrder?: number;
  seriesTotal?: number;
  dailyBudget: number;
  startDate: string;
  endDate?: string;
  /** Base CPC ceiling (from RRP-derived bid economics, or a manual override) everything else scales off of. */
  baseBid: number;
  /** Ad groups with neither keywords nor product targets are skipped. */
  adGroups: SpmAdGroup[];
  /** Optional: add separate metadata sheet */
  includeMetadataSheet?: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function buildBulksheet(input: BulksheetInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // Add metadata sheet if requested
  if (input.includeMetadataSheet) {
    addMetadataSheet(workbook, input);
  }

  // Add main Sponsored Products sheet
  const sheet = workbook.addWorksheet("Sponsored Products Campaigns");
  sheet.columns = COLUMNS.map((header) => ({ header, key: header, width: 24 }));

  const rows: Row[] = [];

  rows.push({
    Product: "Sponsored Products",
    Entity: "Campaign",
    Operation: "Create",
    "Campaign Name": input.campaignName,
    "Start Date": formatDate(input.startDate),
    ...(input.endDate && { "End Date": formatDate(input.endDate) }),
    "Targeting Type": "Manual",
    State: "enabled",
    "Daily Budget": input.dailyBudget,
    "Bidding Strategy": "Dynamic bids - down only",
  });

  for (const adGroup of input.adGroups) {
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
      // Validate ASIN before shipping to bulksheet (§2.2)
      if (!isValidProductAsin(target.asin)) {
        console.warn(
          `[buildBulksheet] Skipping invalid product target ASIN: "${target.asin}"`
        );
        continue;
      }

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

  sheet.addRows(rows);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Adds a metadata sheet with book information and campaign details.
 * This sheet can be used for tracking and reference purposes.
 */
function addMetadataSheet(workbook: ExcelJS.Workbook, input: BulksheetInput): void {
  const sheet = workbook.addWorksheet("Book Metadata", { state: "hidden" });

  // Add metadata rows with labels in first column
  const metadata = [
    ["Campaign ID", input.campaignId || "Auto-generated on upload"],
    ["Campaign Name", input.campaignName],
    ["Book Title", input.bookTitle || "—"],
    ["Author", input.author || "—"],
    ...(input.seriesName ? [["Series Name", input.seriesName]] : []),
    ...(input.seriesOrder ? [["Series Book #", `Book ${input.seriesOrder}${input.seriesTotal ? ` of ${input.seriesTotal}` : ""}`]] : []),
    ["ASIN", input.asin],
    ["Created", new Date().toISOString()],
    ["Daily Budget", `$${input.dailyBudget}`],
    ["Start Date", input.startDate],
    ["End Date", input.endDate || "Ongoing"],
    ["Base Bid", `$${input.baseBid.toFixed(2)}`],
    ["", ""],
    ["Ad Groups Summary", ""],
  ];

  // Add ad group summary
  let adGroupNum = 1;
  for (const adGroup of input.adGroups) {
    const keywordCount = adGroup.keywords?.length ?? 0;
    const targetCount = adGroup.productTargets?.length ?? 0;
    if (keywordCount > 0 || targetCount > 0) {
      metadata.push([
        `${adGroupNum}. ${adGroup.name}`,
        `${keywordCount} keywords, ${targetCount} targets, $${adGroup.defaultBid.toFixed(2)} default bid`,
      ]);
      adGroupNum++;
    }
  }

  sheet.addRows(metadata);

  // Format metadata sheet
  sheet.getColumn(1).width = 20;
  sheet.getColumn(2).width = 60;

  for (let i = 1; i <= metadata.length; i++) {
    const cell = sheet.getCell(i, 1);
    cell.font = { bold: true };
  }
}
