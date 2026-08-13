import { describe, expect, it } from "vitest";
import { scoreAsinSpecificity } from "../lib/asinSpecificity";
import type { BookAnchors } from "../lib/keywordAnchors";

const anchors: BookAnchors = {
  bookSpecific: ["scars of the past", "mcneill", "dci mcneill"],
  genre: ["crime", "thriller"],
  setting: ["scotland", "scottish"],
  comps: ["ian rankin", "val mcdermid", "knots and crosses"],
  bookIntent: ["books", "kindle", "read"],
  primaryGenrePhrase: "scottish crime thriller",
};

describe("scoreAsinSpecificity", () => {
  it("returns null when the ASIN has no title/author metadata", () => {
    expect(scoreAsinSpecificity({}, anchors)).toBeNull();
    expect(scoreAsinSpecificity({ title: null, author: null }, anchors)).toBeNull();
  });

  it("scores an ASIN whose author and title both match a tracked comp as very specific", () => {
    const score = scoreAsinSpecificity({ title: "Knots and Crosses", author: "Ian Rankin" }, anchors);
    expect(score).toBe(5);
  });

  it("scores a comp-author match (mismatched title) as specific", () => {
    const score = scoreAsinSpecificity({ title: "Some Other Novel", author: "Ian Rankin" }, anchors);
    expect(score).toBeGreaterThanOrEqual(4);
  });

  it("scores genre/setting overlap with no comp match as medium", () => {
    const score = scoreAsinSpecificity({ title: "A Scottish Crime Mystery", author: "Someone Else" }, anchors);
    expect(score).toBe(3);
  });

  it("scores no overlap at all as broad", () => {
    const score = scoreAsinSpecificity({ title: "A Cookbook for Beginners", author: "Jane Cook" }, anchors);
    expect(score).toBeLessThanOrEqual(2);
  });

  it("always returns a value in [1, 5] or null", () => {
    const score = scoreAsinSpecificity({ title: "x", author: "y" }, anchors);
    expect(score === null || (score >= 1 && score <= 5)).toBe(true);
  });
});
