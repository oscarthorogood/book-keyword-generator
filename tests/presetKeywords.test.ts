import { describe, expect, it } from "vitest";
import { matchGenresToBook, presetKeywordsForGenres } from "../lib/presetKeywords";

describe("matchGenresToBook", () => {
  const genres = [
    { id: "g1", name: "Cozy Mystery", parentId: null },
    { id: "g2", name: "Epic Fantasy", parentId: null },
    { id: "g3", name: "Thriller", parentId: null },
  ];

  it("matches genres present (exactly or as a substring) in the book's resolved genre terms", () => {
    const matched = matchGenresToBook(genres, ["cozy mystery", "amateur sleuth"]);
    expect(matched.map((g) => g.id)).toEqual(["g1"]);
  });

  it("matches when the book's term is a superstring of the preset genre name", () => {
    const matched = matchGenresToBook(genres, ["cozy mystery cat cafe series"]);
    expect(matched.map((g) => g.id)).toEqual(["g1"]);
  });

  it("returns nothing when no genre matches", () => {
    expect(matchGenresToBook(genres, ["romance"])).toEqual([]);
  });
});

describe("presetKeywordsForGenres", () => {
  const presetKeywords = [
    { id: "pk1", genreId: "g1", keyword: "cozy mystery series", matchType: "phrase" as const, tier: "a" as const },
    { id: "pk2", genreId: "g1", keyword: "amateur sleuth books", matchType: "broad" as const, tier: "b" as const },
    { id: "pk3", genreId: "g2", keyword: "dragon rider saga", matchType: "exact" as const, tier: "a" as const },
  ];

  it("only returns preset keywords under matched genres", () => {
    const { candidates, tierById } = presetKeywordsForGenres(presetKeywords, new Set(["g1"]));
    expect(candidates.map((c) => c.text)).toEqual(["cozy mystery series", "amateur sleuth books"]);
    expect(candidates.every((c) => c.sources.includes("genre-preset"))).toBe(true);
    expect(tierById.get("pk1")).toBe("a");
    expect(tierById.get("pk2")).toBe("b");
  });

  it("returns nothing when no genres match", () => {
    const { candidates } = presetKeywordsForGenres(presetKeywords, new Set());
    expect(candidates).toEqual([]);
  });
});
