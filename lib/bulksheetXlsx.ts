/**
 * Renders upload rows (lib/bulksheetUpload.ts) as an .xlsx workbook via
 * `exceljs` — the *-upload.xlsx* half of Prerequisite A (campaigns spec
 * §1.1/§8 PR 3). The *-review.csv* path (lib/bulksheet.ts) is unaffected.
 */

import ExcelJS from "exceljs";
import { BULKSHEET_UPLOAD_COLUMNS, type UploadRow } from "./bulksheetSchema";

const SHEET_NAME = "Sponsored Products";

/**
 * Builds the workbook buffer for a set of upload rows, header first.
 *
 * Returns `ArrayBuffer` rather than Node's `Buffer` — exceljs's own `Buffer`
 * type (what `writeBuffer()` resolves to) is declared as a bare
 * `interface Buffer extends ArrayBuffer {}`, which conflicts with the
 * generic `Buffer<ArrayBufferLike>` shape newer `@types/node` versions use.
 * `ArrayBuffer` is the type both sides actually agree on; callers wrap it in
 * `new Uint8Array(...)` same as they would a Node Buffer.
 */
export async function buildUploadXlsx(rows: UploadRow[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(SHEET_NAME);

  sheet.columns = BULKSHEET_UPLOAD_COLUMNS.map((column) => ({ header: column, key: column }));
  for (const row of rows) {
    sheet.addRow(BULKSHEET_UPLOAD_COLUMNS.map((column) => row[column]));
  }

  return workbook.xlsx.writeBuffer();
}

export interface CampaignReviewSheetRow {
  targetText: string;
  type: string;
  bid: number | null;
}

export interface CampaignReviewSheet {
  /** Excel sheet names are capped at 31 chars and can't contain \ / ? * [ ] : — sanitized/truncated by the caller. */
  sheetName: string;
  rows: CampaignReviewSheetRow[];
}

/**
 * "Export campaigns" — one workbook, one sheet per campaign, columns
 * ASIN/Keyword | Type | Bid. This is the human-facing review export,
 * distinct from the Amazon-importable *-upload.xlsx built by
 * buildUploadXlsx above.
 */
export async function buildCampaignReviewWorkbook(sheets: CampaignReviewSheet[]): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  for (const { sheetName, rows } of sheets) {
    let name = sheetName.replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Campaign";
    let suffix = 2;
    while (usedNames.has(name)) {
      const base = sheetName.replace(/[\\/?*[\]:]/g, "-").slice(0, 28);
      name = `${base}-${suffix++}`;
    }
    usedNames.add(name);

    const sheet = workbook.addWorksheet(name);
    sheet.columns = [
      { header: "ASIN/Keyword", key: "targetText", width: 40 },
      { header: "Type", key: "type", width: 16 },
      { header: "Bid", key: "bid", width: 10 },
    ];
    for (const row of rows) {
      sheet.addRow({ targetText: row.targetText, type: row.type, bid: row.bid ?? "" });
    }
  }

  return workbook.xlsx.writeBuffer();
}
