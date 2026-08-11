/**
 * Phase-1 regression fixtures (Enhancements spec §0.3): the ground-truth
 * failure modes the audit docs call out by name. These protect the base
 * every later Enhancements-spec section builds on top of, so a source or
 * filter change that quietly reopens one of these fails loudly here
 * instead of shipping in a bulksheet.
 */

import { describe, expect, it } from "vitest";
import { normalizeAsinOrIsbn } from "../lib/isbn";
import {
  containsNonBookProductTerm,
  getKeywordQualityAdjustment,
  isCategoryLabelMisapplication,
  isMalformedProductTile,
} from "../lib/keywordValidation";
import {
  assessCompDataHealth,
  filterHallucinatedCompKeywords,
  mightBeHallucination,
} from "../lib/compDataValidation";
import type { RelatedCompetitor } from "../lib/types";

describe("regression fixtures (§0.3)", () => {
  it("rejects the invalid ASIN CLOVERLEAF", () => {
    // 10 uppercase letters — ASIN *shaped* but neither a real Amazon B0
    // ASIN nor a checksum-valid ISBN-10.
    expect(normalizeAsinOrIsbn("CLOVERLEAF")).toBeNull();
  });

  it("accepts a real B0-prefixed ASIN and a checksum-valid ISBN-10", () => {
    expect(normalizeAsinOrIsbn("B0CLY37W22")).toBe("B0CLY37W22");
    // "0-306-40615-2" is the canonical ISBN-10 checksum example.
    expect(normalizeAsinOrIsbn("0306406152")).toBe("0306406152");
  });

  it("rejects the malformed 'book cover ..., kindle unlimited' product-tile pattern", () => {
    const text = "book cover the inmate: a gripping thriller, kindle unlimited";
    expect(isMalformedProductTile(text)).toBe(true);
    expect(getKeywordQualityAdjustment(text)).toBeLessThanOrEqual(-50);
  });

  it("never produces 'cozy kindle store' as a category-label misapplication", () => {
    expect(isCategoryLabelMisapplication("cozy kindle store")).toBe(true);
    expect(getKeywordQualityAdjustment("cozy kindle store")).toBeLessThan(0);
  });

  it("filters 'barclaycard' out of comp/keyword candidates", () => {
    expect(containsNonBookProductTerm("barclaycard")).toBe(true);
    expect(getKeywordQualityAdjustment("barclaycard")).toBeLessThanOrEqual(-50);
  });

  it("never backfills hallucinated names for a book with only 1 real comp", () => {
    const oneComp: RelatedCompetitor[] = [{ asin: "B0X1", title: "Some Real Comp", author: "Real Author" }];
    const health = assessCompDataHealth(oneComp);
    expect(health.hasEnoughData).toBe(false);
    expect(health.realCompCount).toBe(1);

    // A. A. Fair is a real (unrelated) pen name that a name-similarity
    // backfill could plausibly generate for a thin-comp indie author.
    expect(mightBeHallucination("a.a. fair books in order")).toBe(true);

    const candidates = [
      { text: "a.a. fair books in order" },
      { text: "some real comp" },
    ];
    const filtered = filterHallucinatedCompKeywords(candidates, health);
    expect(filtered.map((k) => k.text)).toEqual(["some real comp"]);
  });

  it("backfills normally once comp data is no longer thin (3+ real comps)", () => {
    const threeComps: RelatedCompetitor[] = [
      { asin: "B0X1", title: "Comp One", author: "Author One" },
      { asin: "B0X2", title: "Comp Two", author: "Author Two" },
      { asin: "B0X3", title: "Comp Three", author: "Author Three" },
    ];
    const health = assessCompDataHealth(threeComps);
    expect(health.hasEnoughData).toBe(true);

    const candidates = [{ text: "a.a. fair books in order" }];
    // Enough real data — filterHallucinatedCompKeywords trusts it and
    // doesn't apply the thin-comp hallucination guard.
    expect(filterHallucinatedCompKeywords(candidates, health)).toEqual(candidates);
  });
});
