import { describe, expect, it } from "vitest";
import { pickMatchType } from "../lib/keywordMerge";
import type { KeywordCandidate } from "../lib/types";

function candidate(text: string, sources: KeywordCandidate["sources"] = ["book-content"]): KeywordCandidate {
  return { text, sources };
}

describe("pickMatchType with a match-type profile (§21)", () => {
  it("defaults to the mixed triple (broad/phrase/exact by length and source)", () => {
    expect(pickMatchType(candidate("mystery"))).toBe("broad");
    expect(pickMatchType(candidate("cozy mystery series"))).toBe("phrase");
    expect(pickMatchType(candidate("val mcdermid", ["comp-name"]))).toBe("exact");
  });

  it("under phrase-only, never returns broad for a non-comp candidate", () => {
    expect(pickMatchType(candidate("mystery"), "phrase-only")).toBe("phrase");
    expect(pickMatchType(candidate("cozy mystery series"), "phrase-only")).toBe("phrase");
  });

  it("under phrase-only, comp-name candidates still run exact", () => {
    expect(pickMatchType(candidate("val mcdermid", ["comp-name"]), "phrase-only")).toBe("exact");
  });
});
