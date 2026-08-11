/**
 * lib/decodoClient.ts — the live Decodo fetch path. No real network calls:
 * `fetch` is mocked per test. Covers configuration detection, a successful
 * fetch producing rows that flow through buildDecodoCandidates unchanged,
 * and graceful degradation to [] on failure/malformed responses.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildDecodoCandidates } from "../lib/decodoSource";

const ORIGINAL_ENV = process.env.DECODO_API_KEY;

async function freshImport() {
  vi.resetModules();
  return import("../lib/decodoClient");
}

describe("decodoClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.DECODO_API_KEY;
    else process.env.DECODO_API_KEY = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it("isDecodoConfigured() reflects DECODO_API_KEY", async () => {
    delete process.env.DECODO_API_KEY;
    let mod = await freshImport();
    expect(mod.isDecodoConfigured()).toBe(false);

    process.env.DECODO_API_KEY = "test-key";
    mod = await freshImport();
    expect(mod.isDecodoConfigured()).toBe(true);
  });

  it("returns [] without calling fetch when unconfigured", async () => {
    delete process.env.DECODO_API_KEY;
    const mod = await freshImport();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchDecodoKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a successful scrape response into DecodoRows that work through buildDecodoCandidates", async () => {
    process.env.DECODO_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          {
            content: {
              results: {
                related_searches: ["cozy mystery series", { query: "small town mystery books" }],
                organic: [{ title: "The Cat Who Solved It" }],
              },
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchDecodoKeywordRows(["cozy mystery"], "US");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rows.length).toBe(3);
    expect(rows[0]).toEqual({ text: "cozy mystery series", score: 1 });
    expect(rows.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);

    const candidates = buildDecodoCandidates({ title: "Some Book" }, rows);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.sources.includes("decodo"))).toBe(true);
  });

  it("degrades to [] on a non-2xx response without throwing", async () => {
    process.env.DECODO_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchDecodoKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
  });

  it("degrades to [] when fetch throws", async () => {
    process.env.DECODO_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchDecodoKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
  });

  it("degrades to [] when the response shape doesn't match what's expected", async () => {
    process.env.DECODO_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchDecodoKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
  });
});
