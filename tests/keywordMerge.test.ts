import { describe, expect, it } from "vitest";
import { collapseNearDuplicates, dedupeSignature } from "../lib/keywordMerge";
import { KeywordCandidate } from "../lib/types";

function candidate(text: string): KeywordCandidate {
  return { text, sources: ["autocomplete"] };
}

describe("dedupeSignature", () => {
  it("is case-insensitive", () => {
    expect(dedupeSignature("Scottish Highlands")).toBe(dedupeSignature("scottish highlands"));
  });

  it("is word-order- and plural-insensitive regardless of case", () => {
    expect(dedupeSignature("Wizard Schools Book")).toBe(dedupeSignature("wizard school books"));
  });

  it("does not silently drop uppercase letters instead of case-folding them", () => {
    const sig = dedupeSignature("Scottish Highlands");
    expect(sig).toContain("scottish");
    expect(sig).toContain("highland");
  });
});

describe("collapseNearDuplicates", () => {
  it("collapses near-duplicates that differ only in case", () => {
    const result = collapseNearDuplicates([candidate("Scottish Highlands"), candidate("scottish highlands")]);
    expect(result).toHaveLength(1);
  });
});
