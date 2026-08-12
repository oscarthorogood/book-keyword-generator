import { describe, expect, it } from "vitest";
import { parseCsv } from "../lib/csv";

describe("parseCsv", () => {
  it("parses a simple CSV into records keyed by the header row", () => {
    const text = "Campaign Name,Clicks,Spend\nMy Book,10,5.50\nOther Book,3,1.25";
    expect(parseCsv(text)).toEqual([
      { "Campaign Name": "My Book", Clicks: "10", Spend: "5.50" },
      { "Campaign Name": "Other Book", Clicks: "3", Spend: "1.25" },
    ]);
  });

  it("handles quoted fields containing commas", () => {
    const text = 'Targeting,Bid\n"asin=""B0EXAMPLE1""",0.50';
    expect(parseCsv(text)).toEqual([{ Targeting: 'asin="B0EXAMPLE1"', Bid: "0.50" }]);
  });

  it("handles quoted fields containing embedded newlines", () => {
    const text = 'Name,Notes\nBook,"line one\nline two"';
    expect(parseCsv(text)).toEqual([{ Name: "Book", Notes: "line one\nline two" }]);
  });

  it("handles CRLF line endings", () => {
    const text = "A,B\r\n1,2\r\n3,4";
    expect(parseCsv(text)).toEqual([
      { A: "1", B: "2" },
      { A: "3", B: "4" },
    ]);
  });

  it("returns [] for an empty or header-only file", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("A,B\n")).toEqual([]);
  });
});
