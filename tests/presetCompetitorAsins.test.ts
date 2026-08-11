import { describe, expect, it } from "vitest";
import { presetCompetitorAsinsForGenres } from "../lib/presetCompetitorAsins";

describe("presetCompetitorAsinsForGenres", () => {
  const presetCompetitorAsins = [
    { id: "pc1", genreId: "g1", competitorAsin: "b0h889wwgw", notes: "Silent Scream — Angela Marsons", tier: "a" as const },
    { id: "pc2", genreId: "g1", competitorAsin: "B0OTHERONE", notes: null, tier: "b" as const },
    { id: "pc3", genreId: "g2", competitorAsin: "B0UNRELATED", notes: null, tier: "a" as const },
  ];

  it("only returns preset competitor ASINs under matched genres, uppercased", () => {
    const { candidates, tierById } = presetCompetitorAsinsForGenres(presetCompetitorAsins, new Set(["g1"]));
    expect(candidates.map((c) => c.competitorAsin)).toEqual(["B0H889WWGW", "B0OTHERONE"]);
    expect(tierById.get("pc1")).toBe("a");
    expect(tierById.get("pc2")).toBe("b");
  });

  it("returns nothing when no genres match", () => {
    const { candidates } = presetCompetitorAsinsForGenres(presetCompetitorAsins, new Set());
    expect(candidates).toEqual([]);
  });

  it("carries notes and the preset id through to the candidate", () => {
    const { candidates } = presetCompetitorAsinsForGenres(presetCompetitorAsins, new Set(["g1"]));
    expect(candidates[0]).toEqual({
      competitorAsin: "B0H889WWGW",
      notes: "Silent Scream — Angela Marsons",
      presetCompetitorAsinId: "pc1",
    });
  });
});
