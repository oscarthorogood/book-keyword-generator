import { describe, expect, it } from "vitest";
import {
  findNegativeCollisions,
  mergeNegatives,
  selectApplicableNegatives,
  type LibraryNegativeRow,
} from "../lib/negativeKeywordLibrary";

describe("selectApplicableNegatives", () => {
  const rows: LibraryNegativeRow[] = [
    { keyword: "barclaycard", matchType: "exact", scope: "global", genreId: null, bookId: null, reason: "off-topic" },
    { keyword: "cozy kindle store", matchType: "phrase", scope: "genre", genreId: "g1", bookId: null, reason: "template" },
    { keyword: "another genre term", matchType: "phrase", scope: "genre", genreId: "g2", bookId: null, reason: "template" },
    { keyword: "book-specific junk", matchType: "phrase", scope: "book", genreId: null, bookId: "b1", reason: "manual" },
    { keyword: "other book junk", matchType: "phrase", scope: "book", genreId: null, bookId: "b2", reason: "manual" },
  ];

  it("includes global rows always, genre rows only when matched, book rows only for this book", () => {
    const applicable = selectApplicableNegatives(rows, "b1", new Set(["g1"]));
    expect(applicable.map((r) => r.keyword)).toEqual([
      "barclaycard",
      "cozy kindle store",
      "book-specific junk",
    ]);
  });

  it("returns just the global rows when no genre matches and it's a different book", () => {
    const applicable = selectApplicableNegatives(rows, "b3", new Set());
    expect(applicable.map((r) => r.keyword)).toEqual(["barclaycard"]);
  });
});

describe("mergeNegatives", () => {
  it("dedupes by text, keeping the book's own negative on a collision", () => {
    const merged = mergeNegatives(
      [{ text: "barclaycard", matchType: "exact", reason: "book-specific reason" }],
      [
        { keyword: "Barclaycard", matchType: "exact", scope: "global", genreId: null, bookId: null, reason: "library reason" },
        { keyword: "cozy kindle store", matchType: "phrase", scope: "global", genreId: null, bookId: null, reason: "library reason" },
      ]
    );
    expect(merged).toHaveLength(2);
    expect(merged.find((n) => n.text === "barclaycard")!.reason).toBe("book-specific reason");
    expect(merged.some((n) => n.text === "cozy kindle store")).toBe(true);
  });
});

describe("findNegativeCollisions", () => {
  it("finds an active keyword matching the proposed negative", () => {
    const collisions = findNegativeCollisions("cozy mystery", ["Cozy Mystery", "amateur sleuth"]);
    expect(collisions).toEqual(["Cozy Mystery"]);
  });

  it("returns nothing when there's no collision", () => {
    expect(findNegativeCollisions("barclaycard", ["cozy mystery"])).toEqual([]);
  });
});

// Library rows are typed in by hand, so they get the same word-count clamp
// the generated negatives do — Amazon rejects an over-length row at upload.
describe("mergeNegatives length limits", () => {
  it("narrows a library phrase row over the 4-word limit to exact", () => {
    const merged = mergeNegatives(
      [],
      [
        {
          keyword: "world of warcraft quest walkthrough",
          matchType: "phrase",
          scope: "global",
          genreId: null,
          bookId: null,
          reason: "off-topic",
        },
      ]
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].matchType).toBe("exact");
  });

  it("skips a library row too long for even a negative exact", () => {
    const merged = mergeNegatives(
      [],
      [
        {
          keyword: "one two three four five six seven eight nine ten eleven",
          matchType: "phrase",
          scope: "global",
          genreId: null,
          bookId: null,
          reason: "off-topic",
        },
      ]
    );
    expect(merged).toEqual([]);
  });
});
