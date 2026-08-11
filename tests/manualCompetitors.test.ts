import { describe, expect, it } from "vitest";
import { isApprovedAuthor, manualCompetitors } from "../lib/manualCompetitors";
import { buildManualCompetitorCandidates } from "../lib/keywordMerge";

const KNOWN_ASIN = "B0H889WWGW";

describe("manualCompetitors", () => {
  it("treats the book's own author as approved", () => {
    expect(isApprovedAuthor("Jacqueline New", "Jacqueline New", KNOWN_ASIN)).toBe(true);
  });

  it("treats a curated comp author for the ASIN as approved", () => {
    expect(isApprovedAuthor("Val McDermid", "Jacqueline New", KNOWN_ASIN)).toBe(true);
  });

  it("is case/whitespace insensitive", () => {
    expect(isApprovedAuthor("  val mcdermid  ", "Jacqueline New", KNOWN_ASIN)).toBe(true);
  });

  it("rejects an author not on the curated list for that ASIN", () => {
    expect(isApprovedAuthor("Some Rando Author", "Jacqueline New", KNOWN_ASIN)).toBe(false);
  });

  it("falls back to the full pool when no ASIN is given", () => {
    expect(isApprovedAuthor("Val McDermid", "Jacqueline New")).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(isApprovedAuthor("", "Jacqueline New", KNOWN_ASIN)).toBe(false);
  });
});

describe("buildManualCompetitorCandidates", () => {
  it("returns candidates for a known ASIN, deduped and normalised", () => {
    const candidates = buildManualCompetitorCandidates(KNOWN_ASIN);
    const entry = manualCompetitors[KNOWN_ASIN];
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(entry.authors.length + entry.titles.length);
    for (const candidate of candidates) {
      expect(candidate.sources).toEqual(["comp-name"]);
    }
    expect(candidates.some((c) => c.text === "val mcdermid")).toBe(true);
  });

  it("returns nothing for an unknown ASIN or no ASIN", () => {
    expect(buildManualCompetitorCandidates("B0UNKNOWNASIN")).toEqual([]);
    expect(buildManualCompetitorCandidates(undefined)).toEqual([]);
  });
});
