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
