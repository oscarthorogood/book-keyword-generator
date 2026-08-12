import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildUploadXlsx } from "../lib/bulksheetXlsx";
import { BULKSHEET_UPLOAD_COLUMNS, buildProductAdRow, buildUploadCampaignRow } from "../lib/bulksheetSchema";

describe("buildUploadXlsx (campaigns spec §1.1/§8 PR 3)", () => {
  it("writes a header row matching BULKSHEET_UPLOAD_COLUMNS, then one row per input row", async () => {
    const rows = [
      buildUploadCampaignRow({ name: "My Book – Descriptive", dailyBudget: 25, targetingType: "manual" }),
      buildProductAdRow({ campaign: "My Book – Descriptive", adGroup: "Descriptive", sku: "B0EXAMPLE1" }),
    ];

    const arrayBuffer = await buildUploadXlsx(rows);
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    const sheet = workbook.worksheets[0];

    const headerRow = sheet.getRow(1).values as unknown[];
    // exceljs row.values is 1-indexed with a leading empty slot.
    expect(headerRow.slice(1)).toEqual([...BULKSHEET_UPLOAD_COLUMNS]);

    expect(sheet.rowCount).toBe(rows.length + 1);

    const dataRow = sheet.getRow(2).values as unknown[];
    const entityIndex = BULKSHEET_UPLOAD_COLUMNS.indexOf("Entity") + 1;
    expect(dataRow[entityIndex]).toBe("Campaign");
  });

  it("produces a workbook with no rows for an empty input", async () => {
    const arrayBuffer = await buildUploadXlsx([]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(arrayBuffer);
    expect(workbook.worksheets[0].rowCount).toBe(1); // header only
  });
});
