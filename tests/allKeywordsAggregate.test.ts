import { describe, expect, it } from "vitest";
import { aggregateKeywordsAcrossBooks } from "../lib/allKeywordsAggregate";

describe("aggregateKeywordsAcrossBooks", () => {
  it("groups the same keyword text across books, case-insensitively", () => {
    const rows = aggregateKeywordsAcrossBooks([
      { book_id: "b1", book_title: "Book One", text: "cozy mystery", status: "active", match_type: "phrase", source: "autocomplete", specificity: 3 },
      { book_id: "b2", book_title: "Book Two", text: "Cozy Mystery", status: "paused", match_type: "broad", source: "book-content", specificity: 2 },
      { book_id: "b3", book_title: "Book Three", text: "dragon rider saga", status: "active", match_type: "exact", source: "comp-name", specificity: 5 },
    ]);

    expect(rows).toHaveLength(2);
    const cozy = rows.find((r) => r.key === "cozy mystery")!;
    expect(cozy.text).toBe("cozy mystery");
    expect(cozy.books.map((b) => b.bookId)).toEqual(["b1", "b2"]);
    expect(cozy.statuses).toEqual(["active", "paused"]);
    expect(cozy.matchTypes).toEqual(["broad", "phrase"]);
    expect(cozy.maxSpecificity).toBe(3);
  });

  it("sorts most-shared keywords first, then alphabetically", () => {
    const rows = aggregateKeywordsAcrossBooks([
      { book_id: "b1", book_title: "A", text: "solo term", status: "active", match_type: "broad", source: null, specificity: null },
      { book_id: "b1", book_title: "A", text: "shared term", status: "active", match_type: "broad", source: null, specificity: null },
      { book_id: "b2", book_title: "B", text: "shared term", status: "active", match_type: "broad", source: null, specificity: null },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["shared term", "solo term"]);
  });

  it("handles keywords with no specificity", () => {
    const rows = aggregateKeywordsAcrossBooks([
      { book_id: "b1", book_title: "A", text: "term", status: "active", match_type: "broad", source: null, specificity: null },
    ]);
    expect(rows[0].maxSpecificity).toBeNull();
    expect(rows[0].sources).toEqual(["unknown"]);
  });
});
