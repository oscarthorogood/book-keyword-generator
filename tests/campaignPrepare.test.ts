import { describe, expect, it } from "vitest";
import { describePrepare, planPrepare, type PrepareBankResult } from "../lib/campaignPrepare";

/**
 * Create Campaigns runs the generation pipeline itself now, so the skip
 * rules are the thing standing between one press and a duplicate paid
 * generation run on every press.
 */
describe("planPrepare", () => {
  it("does nothing when the bank already has campaign-eligible rows", () => {
    expect(planPrepare(40, 400)).toEqual({ generate: false, filter: false });
  });

  it("does nothing on the confirmation round-trip, once generation has filled the bank", () => {
    // First press: empty book, generates. Second press (confirmed: true)
    // re-enters the same route and must not generate again.
    expect(planPrepare(0, 0).generate).toBe(true);
    expect(planPrepare(25, 300).generate).toBe(false);
  });

  it("only filters when rows exist but are all still archived", () => {
    expect(planPrepare(0, 500)).toEqual({ generate: false, filter: true });
  });

  it("generates and filters for a book that has never been researched", () => {
    expect(planPrepare(0, 0)).toEqual({ generate: true, filter: true });
  });

  it("treats a single eligible row as enough to skip — generation is never partial top-up", () => {
    expect(planPrepare(1, 1)).toEqual({ generate: false, filter: false });
  });
});

function result(overrides: Partial<PrepareBankResult> = {}): PrepareBankResult {
  return {
    ran: true,
    generated: false,
    filtered: false,
    presetsApplied: 0,
    generatedKeywords: 0,
    generatedAsins: 0,
    examined: 0,
    warnings: [],
    ...overrides,
  };
}

describe("describePrepare", () => {
  it("says nothing when nothing ran, so an ordinary create reads as an ordinary create", () => {
    expect(describePrepare(result({ ran: false }))).toBeNull();
  });

  it("reports what generation actually found", () => {
    const summary = describePrepare(
      result({ generated: true, generatedKeywords: 312, generatedAsins: 47, filtered: true, examined: 359 })
    );
    expect(summary).toContain("312 keyword(s)");
    expect(summary).toContain("47 ASIN(s)");
    expect(summary).toContain("359 row(s)");
  });

  it("reports a filter-only pass without claiming anything was generated", () => {
    const summary = describePrepare(result({ filtered: true, examined: 120 }));
    expect(summary).toContain("filtered 120 row(s)");
    expect(summary).not.toContain("generated");
  });

  // The flowchart's Create Campaigns branch runs generation, then presets,
  // then the filter pass — the summary reads back in that same order so it
  // describes what actually happened.
  it("orders the summary generation, then presets, then filtering", () => {
    const summary = describePrepare(
      result({ generated: true, generatedKeywords: 300, generatedAsins: 20, presetsApplied: 12, filtered: true, examined: 332 })
    )!;
    expect(summary.indexOf("generated")).toBeLessThan(summary.indexOf("applied"));
    expect(summary.indexOf("applied")).toBeLessThan(summary.indexOf("filtered"));
  });
});
