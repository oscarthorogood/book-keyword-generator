import { describe, expect, it } from "vitest";
import {
  recentBooksSummary,
  summarizeKeywordStats,
  topKeywordsByGenre,
} from "../lib/dashboardStats";

describe("summarizeKeywordStats", () => {
  it("counts by status, match type, source, and specificity", () => {
    const summary = summarizeKeywordStats([
      { status: "active", match_type: "phrase", source: "autocomplete", specificity: 3 },
      { status: "active", match_type: "exact", source: "comp-name", specificity: 5 },
      { status: "rejected", match_type: "broad", source: null, specificity: null },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byStatus).toEqual({ active: 2, rejected: 1 });
    expect(summary.byMatchType).toEqual({ phrase: 1, exact: 1, broad: 1 });
    expect(summary.bySource).toEqual({ autocomplete: 1, "comp-name": 1, unknown: 1 });
    expect(summary.specificityDistribution).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 1, unscored: 1 });
  });
});

describe("topKeywordsByGenre", () => {
  const books = [
    { id: "b1", title: "Book One", genreTerms: ["cozy mystery"] },
    { id: "b2", title: "Book Two", genreTerms: ["epic fantasy"] },
  ];

  it("groups active keywords by each book's primary genre, ranked by specificity", () => {
    const groups = topKeywordsByGenre(books, [
      { book_id: "b1", text: "cozy mystery cat cafe", status: "active", specificity: 4 },
      { book_id: "b1", text: "amateur sleuth", status: "active", specificity: 2 },
      { book_id: "b1", text: "rejected term", status: "rejected", specificity: 5 },
      { book_id: "b2", text: "dragon rider saga", status: "active", specificity: 5 },
    ]);

    const cozy = groups.find((g) => g.genre === "cozy mystery");
    expect(cozy?.keywords.map((k) => k.text)).toEqual(["cozy mystery cat cafe", "amateur sleuth"]);

    const fantasy = groups.find((g) => g.genre === "epic fantasy");
    expect(fantasy?.keywords.map((k) => k.text)).toEqual(["dragon rider saga"]);
  });

  it("skips keywords for books with no resolved genre", () => {
    const groups = topKeywordsByGenre(
      [{ id: "b3", title: "No Genre", genreTerms: [] }],
      [{ book_id: "b3", text: "whatever", status: "active", specificity: 3 }]
    );
    expect(groups).toEqual([]);
  });
});

describe("recentBooksSummary", () => {
  it("sorts newest-first and pulls capture health from metadata_json", () => {
    const summary = recentBooksSummary([
      {
        id: "b1",
        title: "Older",
        author: "A",
        created_at: "2026-01-01T00:00:00Z",
        metadata_json: { capture: { ok: true, completeness: 0.9 } },
      },
      {
        id: "b2",
        title: "Newer",
        author: "B",
        created_at: "2026-06-01T00:00:00Z",
        metadata_json: { capture: { ok: false, completeness: 0.2 } },
      },
    ]);
    expect(summary.map((b) => b.id)).toEqual(["b2", "b1"]);
    expect(summary[0]).toMatchObject({ captureOk: false, completeness: 0.2 });
  });

  it("fails soft when metadata_json is missing (legacy row)", () => {
    const summary = recentBooksSummary([
      { id: "b1", title: "Legacy", author: "A", created_at: "2026-01-01T00:00:00Z", metadata_json: null },
    ]);
    expect(summary[0]).toMatchObject({ captureOk: null, completeness: null });
  });
});
