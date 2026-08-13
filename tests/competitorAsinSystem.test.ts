/**
 * Competitor ASIN system (docs/CLAUDE-CODE-COMPETITORS.md) — unit tests for
 * the pure logic that survives in the generation pipeline: tool-agnostic
 * reverse-ASIN parsing. DB/API routes are exercised manually against a live
 * Supabase project (no local Postgres in this test env, same as the rest of
 * the suite's DB-touching modules).
 */

import { describe, expect, it } from "vitest";
import {
  parseDatadiveRows,
  parseHelium10Rows,
  parseKdpradarRows,
  parseReverseAsinRows,
  parseSellerSpriteRows,
} from "../lib/reverseAsin";

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
