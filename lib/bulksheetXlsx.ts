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
