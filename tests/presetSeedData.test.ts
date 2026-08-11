import { describe, expect, it } from "vitest";
import { VINCI_SEED_GENRES, VINCI_SEED_KEYWORDS } from "../lib/presetSeedData/vinciKeywordBank";

describe("VINCI_SEED_GENRES / VINCI_SEED_KEYWORDS integrity", () => {
  it("has no duplicate genre names", () => {
    const names = VINCI_SEED_GENRES.map((g) => g.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every sub-genre's parent resolves to a top-level genre", () => {
    const topLevelNames = new Set(VINCI_SEED_GENRES.filter((g) => g.parentName === null).map((g) => g.name));
    const subGenres = VINCI_SEED_GENRES.filter((g) => g.parentName !== null);
    expect(subGenres.length).toBeGreaterThan(0);
    for (const sub of subGenres) {
      expect(topLevelNames.has(sub.parentName!)).toBe(true);
    }
  });

  it("every keyword's genreName resolves to a defined genre", () => {
    const genreNames = new Set(VINCI_SEED_GENRES.map((g) => g.name));
    for (const kw of VINCI_SEED_KEYWORDS) {
      expect(genreNames.has(kw.genreName)).toBe(true);
    }
  });

  it("has no duplicate (genreName, keyword) pairs", () => {
    const keys = VINCI_SEED_KEYWORDS.map((k) => `${k.genreName}::${k.keyword.toLowerCase()}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("matches the expected counts from the source export", () => {
    expect(VINCI_SEED_GENRES.length).toBe(69);
    expect(VINCI_SEED_KEYWORDS.length).toBe(800);
  });
});
