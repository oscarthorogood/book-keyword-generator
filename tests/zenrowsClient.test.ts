/**
 * lib/zenrowsClient.ts — the live ZenRows fetch path. No real network calls:
 * `fetch` is mocked per test. Covers configuration detection, a successful
 * scrape producing rows that flow through buildZenrowsCandidates unchanged,
 * and graceful degradation to [] on failure/malformed responses.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildZenrowsCandidates } from "../lib/zenrowsSource";

const ORIGINAL_ENV = process.env.ZENROWS_API_KEY;

async function freshImport() {
  vi.resetModules();
  return import("../lib/zenrowsClient");
}

const RELATED_SEARCHES_HTML = `
  <html><body>
    <div data-component-type="s-related-searches">
      <a>cozy mystery series</a>
      <a>small town mystery books</a>
    </div>
  </body></html>
`;

const ORGANIC_ONLY_HTML = `
  <html><body>
    <div data-component-type="s-search-result">
      <h2><span>The Cat Who Solved It</span></h2>
    </div>
  </body></html>
`;

describe("zenrowsClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.ZENROWS_API_KEY;
    else process.env.ZENROWS_API_KEY = ORIGINAL_ENV;
    vi.unstubAllGlobals();
  });

  it("isZenrowsConfigured() reflects ZENROWS_API_KEY", async () => {
    delete process.env.ZENROWS_API_KEY;
    let mod = await freshImport();
    expect(mod.isZenrowsConfigured()).toBe(false);

    process.env.ZENROWS_API_KEY = "test-key";
    mod = await freshImport();
    expect(mod.isZenrowsConfigured()).toBe(true);
  });

  it("returns [] without calling fetch when unconfigured", async () => {
    delete process.env.ZENROWS_API_KEY;
    const mod = await freshImport();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchZenrowsKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("normalizes a successful scrape response into ZenrowsRows that work through buildZenrowsCandidates", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => RELATED_SEARCHES_HTML,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchZenrowsKeywordRows(["cozy mystery"], "US");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rows.length).toBe(2);
    expect(rows[0]).toEqual({ text: "cozy mystery series", score: 1 });
    expect(rows.every((r) => r.score >= 0 && r.score <= 1)).toBe(true);

    const candidates = buildZenrowsCandidates({ title: "Some Book" }, rows);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((c) => c.sources.includes("zenrows"))).toBe(true);
  });

  it("falls back to organic result titles when no related-searches strip is present", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => ORGANIC_ONLY_HTML,
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchZenrowsKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([{ text: "the cat who solved it", score: 1 }]);
  });

  it("degrades to [] on a non-2xx response without throwing", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal error",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchZenrowsKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
  });

  it("degrades to [] when fetch throws", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchZenrowsKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
  });

  it("degrades to [] when the page has neither related searches nor organic results", async () => {
    process.env.ZENROWS_API_KEY = "test-key";
    const mod = await freshImport();

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "<html><body>captcha</body></html>",
    });
    vi.stubGlobal("fetch", fetchSpy);

    const rows = await mod.fetchZenrowsKeywordRows(["cozy mystery"], "US");
    expect(rows).toEqual([]);
  });
});
