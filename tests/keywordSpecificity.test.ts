import { describe, expect, it } from "vitest";
import { scoreSpecificity } from "../lib/keywordSpecificity";
import type { BookAnchors } from "../lib/keywordAnchors";
import type { KeywordCandidate } from "../lib/types";

const anchors: BookAnchors = {
  bookSpecific: ["scars of the past", "mcneill", "dci mcneill"],
  genre: ["crime", "thriller"],
  setting: ["scotland", "scottish"],
  comps: ["ian rankin", "val mcdermid"],
  bookIntent: ["books", "kindle", "read"],
  primaryGenrePhrase: "scottish crime thriller",
};

function candidate(text: string, overrides: Partial<KeywordCandidate> = {}): KeywordCandidate {
  return { text, sources: ["book-content"], ...overrides };
}

describe("scoreSpecificity", () => {
  it("scores bare generic book-intent words as broad", () => {
    expect(scoreSpecificity(candidate("kindle books"), anchors)).toBeLessThanOrEqual(2);
    expect(scoreSpecificity(candidate("books"), anchors)).toBeLessThanOrEqual(2);
  });

  it("scores a bare core-genre category as broad even alone", () => {
    expect(scoreSpecificity(candidate("crime", { category: "core-genre" }), anchors)).toBeLessThanOrEqual(2);
  });

  it("scores a 3-5 word phrase as medium", () => {
    const score = scoreSpecificity(candidate("scottish crime thriller series"), anchors);
    expect(score).toBeGreaterThanOrEqual(3);
    expect(score).toBeLessThanOrEqual(4);
  });

  it("scores a comp-name candidate as specific even when short, matching pickMatchType's exact-match treatment", () => {
    const score = scoreSpecificity(candidate("val mcdermid", { sources: ["comp-name"] }), anchors);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("scores a book-specific anchor hit (title/author/series) as very specific", () => {
    const score = scoreSpecificity(
      candidate("dci mcneill scars of the past", { sources: ["book-description"] }),
      anchors
    );
    expect(score).toBe(5);
  });

  it("scores comp-titles/competing-authors categories as specific regardless of source", () => {
    const score = scoreSpecificity(
      candidate("val mcdermid", { sources: ["autocomplete"], category: "competing-authors" }),
      anchors
    );
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("always returns a value in [1, 5]", () => {
    const score = scoreSpecificity(candidate("a"), anchors);
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(5);
  });
});
