/**
 * Competitor ASIN system (docs/CLAUDE-CODE-COMPETITORS.md) — unit tests for
 * the pure logic: multi-ASIN aggregation, tool-agnostic parsing, and the
 * competitor slot-reservation helper. DB/API routes are exercised manually
 * against a live Supabase project (no local Postgres in this test env, same
 * as the rest of the suite's DB-touching modules).
 */

import { describe, expect, it } from "vitest";
import {
  aggregateReverseAsinRows,
  parseDatadiveRows,
  parseHelium10Rows,
  parseKdpradarRows,
  parseReverseAsinRows,
  parseSellerSpriteRows,
  type ReverseAsinWithAsin,
} from "../lib/reverseAsin";
import { reserveCompetitorSlots } from "../lib/keywordCapAndRank";
import type { CompetitorKeyword } from "../lib/types";

describe("tool-specific reverse-ASIN parsers", () => {
  it("parses Helium 10 Cerebro columns (the default parseReverseAsinRows shape)", () => {
    const rows = parseHelium10Rows([{ "Keyword Phrase": "val mcdermid books", "Search Volume": 500, Rank: 10 }]);
    expect(rows).toEqual([{ text: "val mcdermid books", volume: 500, rank: 10 }]);
    // parseReverseAsinRows defaults to the helium10 shape, unchanged for existing callers.
    expect(parseReverseAsinRows([{ "Keyword Phrase": "val mcdermid books", "Search Volume": 500, Rank: 10 }])).toEqual(rows);
  });

  it("parses SellerSprite columns", () => {
    const rows = parseSellerSpriteRows([{ Keywords: "silent scream", Searches: 300, "Natural Rank": 25 }]);
    expect(rows).toEqual([{ text: "silent scream", volume: 300, rank: 25 }]);
  });

  it("parses KDPRadar columns", () => {
    const rows = parseKdpradarRows([{ "Search Term": "cozy mystery series", "Est. Searches": 120, Rank: 60 }]);
    expect(rows).toEqual([{ text: "cozy mystery series", volume: 120, rank: 60 }]);
  });

  it("parses DataDive columns", () => {
    const rows = parseDatadiveRows([{ Phrase: "nordic noir books", Volume: 400, "Organic Rank": 15 }]);
    expect(rows).toEqual([{ text: "nordic noir books", volume: 400, rank: 15 }]);
  });

  it("parseReverseAsinRows dispatches by the tool argument", () => {
    const rows = parseReverseAsinRows([{ Keywords: "silent scream", Searches: 300, "Natural Rank": 25 }], "sellersprite");
    expect(rows).toEqual([{ text: "silent scream", volume: 300, rank: 25 }]);
  });
});

describe("aggregateReverseAsinRows", () => {
  const rows: ReverseAsinWithAsin[] = [
    { text: "val mcdermid books", volume: 500, rank: 10, asin: "B001" },
    { text: "val mcdermid books", volume: 300, rank: 20, asin: "B002" },
    { text: "val mcdermid books", volume: 400, rank: 40, asin: "B003" },
    { text: "silent scream", volume: 200, rank: 50, asin: "B001" },
    { text: "obscure single asin term", volume: 1000, rank: 5, asin: "B001" },
    { text: "low volume shared term", volume: 10, rank: 5, asin: "B001" },
    { text: "low volume shared term", volume: 20, rank: 8, asin: "B002" },
  ];

  it("aggregates rows from multiple ASINs, computing competitorCount and meanRank", () => {
    const result = aggregateReverseAsinRows(rows, { minVolume: 0, maxRank: 1000, minCompetitorCount: 1 });
    const mcdermid = result.find((r) => r.text === "val mcdermid books");
    expect(mcdermid).toBeDefined();
    expect(mcdermid?.competitorCount).toBe(3);
    expect(mcdermid?.meanRank).toBeCloseTo((10 + 20 + 40) / 3);
    expect(mcdermid?.rank).toBe(10); // best (lowest) rank
    expect(mcdermid?.volume).toBe(500); // max across the group
  });

  it("drops terms that don't meet the minCompetitorCount threshold (default 2)", () => {
    const result = aggregateReverseAsinRows(rows, { minVolume: 0, maxRank: 1000 });
    expect(result.find((r) => r.text === "obscure single asin term")).toBeUndefined();
  });

  it("applies volume and rank thresholds after aggregation", () => {
    const result = aggregateReverseAsinRows(rows, { minVolume: 100, maxRank: 1000, minCompetitorCount: 2 });
    expect(result.find((r) => r.text === "low volume shared term")).toBeUndefined();
    expect(result.find((r) => r.text === "val mcdermid books")).toBeDefined();
  });

  it("uses the stricter aggregate defaults (MIN_VOLUME_FOR_AGGREGATE_KEEP) when no options are given", () => {
    const result = aggregateReverseAsinRows(rows);
    // "silent scream" is single-ASIN, dropped by minCompetitorCount default.
    expect(result.find((r) => r.text === "silent scream")).toBeUndefined();
  });
});

describe("reserveCompetitorSlots", () => {
  function comp(text: string, volume: number, competitorCount: number): CompetitorKeyword {
    return {
      id: text,
      book_id: "book-1",
      competitor_asin: "B001",
      text,
      volume,
      rank: 10,
      competitor_count: competitorCount,
      mean_rank: null,
      category: null,
      intent_segment: null,
      match_type: "phrase",
      specificity: null,
      status: "active",
      created_at: "",
      updated_at: "",
    };
  }

  it("splits multi-ASIN terms into exact slots and single-ASIN terms into broad slots", () => {
    const keywords = [comp("multi a", 500, 3), comp("multi b", 100, 2), comp("single a", 800, 1)];
    const { exactSlots, broadSlots } = reserveCompetitorSlots(keywords);
    expect(exactSlots.map((k) => k.text)).toEqual(["multi a", "multi b"]);
    expect(broadSlots.map((k) => k.text)).toEqual(["single a"]);
  });

  it("caps each bucket independently and reports overflow", () => {
    const multi = Array.from({ length: 5 }, (_, i) => comp(`multi ${i}`, 100 - i, 2));
    const { exactSlots, overflow } = reserveCompetitorSlots(multi, { maxMultiAsinExactSlots: 2 });
    expect(exactSlots.length).toBe(2);
    expect(overflow.length).toBe(3);
    expect(exactSlots[0].text).toBe("multi 0"); // highest volume first
  });
});
