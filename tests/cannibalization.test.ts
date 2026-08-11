import { describe, expect, it } from "vitest";
import { findCannibalizedKeywords, isCannibalized, othersToPause, suggestOwner } from "../lib/cannibalization";
import type { AggregatedKeywordRow } from "../lib/allKeywordsAggregate";

function row(books: AggregatedKeywordRow["books"]): AggregatedKeywordRow {
  return {
    key: "test",
    text: "test",
    books,
    statuses: [],
    matchTypes: [],
    sources: [],
    specificities: [],
    maxSpecificity: null,
  };
}

describe("isCannibalized", () => {
  it("flags a keyword active on 2+ distinct books by different authors", () => {
    const r = row([
      { bookId: "b1", bookTitle: "Book One", bookAuthor: "Author A", status: "active", specificity: 3, bid: 0.4 },
      { bookId: "b2", bookTitle: "Book Two", bookAuthor: "Author B", status: "active", specificity: 4, bid: 0.5 },
    ]);
    expect(isCannibalized(r)).toBe(true);
  });

  it("does not flag when only one book has it active (others paused/rejected)", () => {
    const r = row([
      { bookId: "b1", bookTitle: "Book One", bookAuthor: "Author A", status: "active", specificity: 3, bid: 0.4 },
      { bookId: "b2", bookTitle: "Book Two", bookAuthor: "Author B", status: "paused", specificity: 4, bid: 0.5 },
    ]);
    expect(isCannibalized(r)).toBe(false);
  });

  it("exempts a same-author brand-defense keyword shared across that author's own books", () => {
    const r = row([
      { bookId: "b1", bookTitle: "Book One", bookAuthor: "Cathy Hayward", status: "active", specificity: 5, bid: 0.4 },
      { bookId: "b2", bookTitle: "Book Two", bookAuthor: "Cathy Hayward", status: "active", specificity: 5, bid: 0.5 },
    ]);
    expect(isCannibalized(r)).toBe(false);
  });

  it("still flags when authors differ even if one book is missing author metadata", () => {
    const r = row([
      { bookId: "b1", bookTitle: "Book One", bookAuthor: "Cathy Hayward", status: "active", specificity: 5, bid: 0.4 },
      { bookId: "b2", bookTitle: "Book Two", bookAuthor: null, status: "active", specificity: 5, bid: 0.5 },
    ]);
    expect(isCannibalized(r)).toBe(true);
  });
});

describe("findCannibalizedKeywords", () => {
  it("filters a list down to the cannibalized rows", () => {
    const shared = row([
      { bookId: "b1", bookTitle: "A", bookAuthor: "X", status: "active", specificity: 3, bid: 0.4 },
      { bookId: "b2", bookTitle: "B", bookAuthor: "Y", status: "active", specificity: 4, bid: 0.5 },
    ]);
    const solo = row([{ bookId: "b1", bookTitle: "A", bookAuthor: "X", status: "active", specificity: 3, bid: 0.4 }]);
    expect(findCannibalizedKeywords([shared, solo])).toEqual([shared]);
  });
});

describe("suggestOwner / othersToPause", () => {
  const r = row([
    { bookId: "b1", bookTitle: "Book One", bookAuthor: "X", status: "active", specificity: 3, bid: 0.4 },
    { bookId: "b2", bookTitle: "Book Two", bookAuthor: "Y", status: "active", specificity: 5, bid: 0.3 },
    { bookId: "b3", bookTitle: "Book Three", bookAuthor: "Z", status: "paused", specificity: 5, bid: 0.9 },
  ]);

  it("picks the highest-specificity active book as owner", () => {
    expect(suggestOwner(r)!.bookId).toBe("b2");
  });

  it("breaks a specificity tie on bid", () => {
    const tied = row([
      { bookId: "b1", bookTitle: "A", bookAuthor: "X", status: "active", specificity: 4, bid: 0.3 },
      { bookId: "b2", bookTitle: "B", bookAuthor: "Y", status: "active", specificity: 4, bid: 0.6 },
    ]);
    expect(suggestOwner(tied)!.bookId).toBe("b2");
  });

  it("lists every other active book (not the owner, not already-paused ones) to pause", () => {
    expect(othersToPause(r, "b2").map((b) => b.bookId)).toEqual(["b1"]);
  });
});
