/**
 * Basic behaviour tests for the new keyword source modules added on top of
 * the filter pipeline: search-term-report, reverse-asin, persona-llm,
 * storygraph-tags, library-subjects, critics-blurbs, decodo.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildSearchTermReportCandidates,
  parseSearchTermReportRows,
} from "../lib/searchTermImport";
import { buildReverseAsinCandidates, parseReverseAsinRows } from "../lib/reverseAsin";
import { buildStorygraphTagsCandidates } from "../lib/storygraphTags";
import { buildLibrarySubjectsCandidates } from "../lib/librarySubjects";
import { buildCriticsBlurbsCandidates } from "../lib/criticsBlurbs";
import { buildDecodoCandidates, parseDecodoRows } from "../lib/decodoSource";

describe("searchTermImport", () => {
  it("keeps rows with orders >= 2 and ACOS <= 0.30, tagged as buyer-intent", () => {
    const rows = parseSearchTermReportRows([
      { "Customer Search Term": "dci mcallister book 1", Clicks: 40, Orders: 5, Spend: 20, ACOS: "20%" },
      { "Customer Search Term": "cheap thriller books", Clicks: 30, Orders: 0, Spend: 15, ACOS: "0%" },
      { "Customer Search Term": "high acos term", Clicks: 10, Orders: 3, Spend: 50, ACOS: "80%" },
    ]);

    const { candidates, negativeSuggestions } = buildSearchTermReportCandidates(
      { title: "Unforgiven", author: "Jacqueline New" },
      rows
    );

    expect(candidates.length).toBe(1);
    expect(candidates[0].text).toBe("dci mcallister book 1");
    expect(candidates[0].sources).toEqual(["search-term-report"]);
    expect(candidates[0].matchType).toBe("exact");
    expect(candidates[0].specificity).toBeGreaterThanOrEqual(4);
    expect(candidates[0].orders).toBe(5);

    expect(negativeSuggestions.some((n) => n.text === "cheap thriller books")).toBe(true);
  });

  it("returns no candidates and no negatives for an empty report", () => {
    const { candidates, negativeSuggestions } = buildSearchTermReportCandidates({}, []);
    expect(candidates).toEqual([]);
    expect(negativeSuggestions).toEqual([]);
  });
});

describe("reverseAsin", () => {
  it("filters to volume/rank thresholds and classifies comp-author vs comp-title", () => {
    const rows = parseReverseAsinRows([
      { "Keyword Phrase": "val mcdermid books", "Search Volume": 500, Rank: 10 },
      { "Keyword Phrase": "silent scream", "Search Volume": 200, Rank: 50 },
      { "Keyword Phrase": "obscure phrase", "Search Volume": 5, Rank: 900 },
    ]);

    const candidates = buildReverseAsinCandidates(
      { author: "Jacqueline New", asin: "B0H889WWGW" },
      rows
    );

    expect(candidates.length).toBe(2);
    const authorMatch = candidates.find((c) => c.text === "val mcdermid books");
    expect(authorMatch?.intentSegment).toBe("comp-author");
    expect(authorMatch?.matchType).toBe("exact");

    const titleMatch = candidates.find((c) => c.text === "silent scream");
    expect(titleMatch?.intentSegment).toBe("comp-title");
    expect(candidates.every((c) => c.sources.includes("reverse-asin"))).toBe(true);
  });

  it("drops rows below the volume/rank thresholds", () => {
    const rows = [{ text: "low volume term", volume: 5, rank: 900 }];
    expect(buildReverseAsinCandidates({}, rows)).toEqual([]);
  });
});

describe("storygraphTags", () => {
  it("templates tags with genre into mood-tone candidates", () => {
    const candidates = buildStorygraphTagsCandidates({ genre: "crime thriller" }, ["dark", "fast-paced"]);
    expect(candidates.some((c) => c.text === "dark crime thriller")).toBe(true);
    expect(candidates.every((c) => c.category === "mood-tone")).toBe(true);
    expect(candidates.every((c) => c.sources.includes("storygraph-tags"))).toBe(true);
  });

  it("returns nothing for no tags", () => {
    expect(buildStorygraphTagsCandidates({}, [])).toEqual([]);
  });
});

describe("librarySubjects", () => {
  it("splits chained LCSH subdivisions into candidates", () => {
    const candidates = buildLibrarySubjectsCandidates(
      { genre: "crime fiction" },
      ["Great Britain -- History -- Fiction"]
    );
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.sources.includes("library-subjects"))).toBe(true);
  });
});

describe("criticsBlurbs", () => {
  it("extracts descriptor phrases and comp mentions from blurb text", () => {
    const candidates = buildCriticsBlurbsCandidates(
      { genre: "crime thriller" },
      ["A gripping, unputdownable read — perfect for fans of Val McDermid."]
    );
    expect(candidates.some((c) => c.intentSegment === "mood-setting")).toBe(true);
    expect(candidates.some((c) => c.text.includes("val mcdermid"))).toBe(true);
  });
});

describe("decodoSource", () => {
  it("filters to the score threshold and classifies branded vs generic terms", () => {
    const rows = parseDecodoRows([
      { text: "unforgiven jacqueline new", score: 90 },
      { text: "dark crime thriller", score: 70 },
      { text: "low score term", score: 20 },
    ]);

    const candidates = buildDecodoCandidates(
      { title: "Unforgiven", author: "Jacqueline New" },
      rows
    );

    expect(candidates.length).toBe(2);
    const branded = candidates.find((c) => c.text === "unforgiven jacqueline new");
    expect(branded?.intentSegment).toBe("alpha-core");
    const mood = candidates.find((c) => c.text === "dark crime thriller");
    expect(mood?.intentSegment).toBe("mood-setting");
    expect(candidates.every((c) => c.sources.includes("decodo"))).toBe(true);
  });
});

describe("llmPersonaSource", () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.OPENROUTER_API_KEY = originalKey;
    vi.unstubAllGlobals();
  });

  it("returns an empty array gracefully when OPENROUTER_API_KEY is not set", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const { buildPersonaLlmCandidates } = await import("../lib/llmPersonaSource");
    const candidates = await buildPersonaLlmCandidates({ title: "Unforgiven", author: "Jacqueline New" });
    expect(candidates).toEqual([]);
  });

  it("parses one query per line into persona-llm candidates without hitting real network", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "deepseek/deepseek-chat-v3-0324:free",
        choices: [
          {
            message: {
              content: "unforgiven jacqueline new\ndark scottish crime thriller\nval mcdermid books",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { buildPersonaLlmCandidates } = await import("../lib/llmPersonaSource");
    const candidates = await buildPersonaLlmCandidates({
      title: "Unforgiven",
      author: "Jacqueline New",
      asin: "B0H889WWGW",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(candidates.length).toBe(3);
    expect(candidates.every((c) => c.sources.includes("persona-llm"))).toBe(true);
    expect(candidates.find((c) => c.text === "unforgiven jacqueline new")?.intentSegment).toBe("alpha-core");
  });
});
