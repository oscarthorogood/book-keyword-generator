import { describe, expect, it } from "vitest";
import { describeExportFailure } from "../lib/campaignExportError";

describe("describeExportFailure", () => {
  it("points a bucket MIME rejection at the migration that fixes it", () => {
    const described = describeExportFailure("mime type text/csv is not supported");

    expect(described).toContain("mime type text/csv is not supported");
    expect(described).toContain("bulksheets");
    expect(described).toContain("sql/30-bulksheets-bucket-mime-types.sql");
  });

  it("matches the xlsx half of the export too, not just the CSV", () => {
    const described = describeExportFailure(
      "mime type application/vnd.openxmlformats-officedocument.spreadsheetml.sheet is not supported"
    );

    expect(described).toContain("sql/30-bulksheets-bucket-mime-types.sql");
  });

  it("leaves unrelated failures untouched", () => {
    for (const message of ["new row violates row-level security policy", "The resource already exists", "fetch failed"]) {
      expect(describeExportFailure(message)).toBe(message);
    }
  });
});
