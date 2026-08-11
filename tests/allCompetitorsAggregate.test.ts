import { describe, expect, it } from "vitest";
import { aggregateCompetitorsAcrossBooks } from "../lib/allCompetitorsAggregate";

function row(overrides: Partial<Parameters<typeof aggregateCompetitorsAcrossBooks>[0][number]> = {}) {
  return {
    book_id: "b1",
    book_title: "A",
    book_author: "Author A",
    competitor_asin: "B0000000A1",
    source: "auto-crawl",
    status: "active",
    bid: 0.5,
    title: null,
    author: null,
    price: null,
    bsr: null,
    competitor_count: null,
    mean_rank: null,
    ...overrides,
  };
}

describe("aggregateCompetitorsAcrossBooks", () => {
  it("groups the same ASIN across books, case-insensitively", () => {
    const rows = aggregateCompetitorsAcrossBooks([
      row({ book_id: "b1", book_title: "Book One", competitor_asin: "b0abcdefgh", status: "active" }),
      row({ book_id: "b2", book_title: "Book Two", competitor_asin: "B0ABCDEFGH", status: "paused" }),
      row({ book_id: "b3", book_title: "Book Three", competitor_asin: "B0OTHERONE" }),
    ]);

    expect(rows).toHaveLength(2);
    const shared = rows.find((r) => r.key === "B0ABCDEFGH")!;
    expect(shared.competitorAsin).toBe("b0abcdefgh");
    expect(shared.books.map((b) => b.bookId)).toEqual(["b1", "b2"]);
    expect(shared.statuses).toEqual(["active", "paused"]);
  });

  it("sorts most-shared ASINs first, then alphabetically", () => {
    const rows = aggregateCompetitorsAcrossBooks([
      row({ book_id: "b1", competitor_asin: "B0SOLOSOLO" }),
      row({ book_id: "b1", competitor_asin: "B0SHAREDXX" }),
      row({ book_id: "b2", competitor_asin: "B0SHAREDXX" }),
    ]);
    expect(rows.map((r) => r.competitorAsin)).toEqual(["B0SHAREDXX", "B0SOLOSOLO"]);
  });

  it("picks the first non-null metadata value across the group", () => {
    const rows = aggregateCompetitorsAcrossBooks([
      row({ book_id: "b1", competitor_asin: "B0METADATA", title: null, price: null }),
      row({ book_id: "b2", competitor_asin: "B0METADATA", title: "Silent Scream", price: 4.99, bsr: 1200 }),
    ]);
    expect(rows[0].title).toBe("Silent Scream");
    expect(rows[0].price).toBe(4.99);
    expect(rows[0].bsr).toBe(1200);
  });

  it("computes maxCompetitorCount across the group, null when never recorded", () => {
    const withCounts = aggregateCompetitorsAcrossBooks([
      row({ book_id: "b1", competitor_asin: "B0COUNTONE", competitor_count: 2 }),
      row({ book_id: "b2", competitor_asin: "B0COUNTONE", competitor_count: 5 }),
    ]);
    expect(withCounts[0].maxCompetitorCount).toBe(5);

    const withoutCounts = aggregateCompetitorsAcrossBooks([row({ competitor_asin: "B0NOCOUNTS" })]);
    expect(withoutCounts[0].maxCompetitorCount).toBeNull();
  });
});
