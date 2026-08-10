/**
 * The Firecrawl scrape request shape.
 *
 * Firecrawl is the capture path that still works when Amazon bot-checks a
 * direct fetch, so a request it rejects is not a degraded capture — it is no
 * capture at all. These tests pin the format names to the ones the v1
 * endpoint actually accepts, after a nested `{ type: "json" }` format (a v2
 * shape) had every fallback attempt coming back as HTTP 400.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

describe("firecrawl structured extraction request", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("asks for the json format by name, with the schema in jsonOptions", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ success: true, data: { json: { title: "A Book" } } })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();

    const { extractAmazonMetadata } = await import("../lib/firecrawl");
    const result = await extractAmazonMetadata("https://www.amazon.com/dp/B0TEST0000");

    expect(result.title).toBe("A Book");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // v1 names formats as strings; the nested `{ type: "json" }` object form
    // belongs to v2 and is rejected here with a 400.
    expect(body.formats).toEqual(["json"]);
    expect(body.jsonOptions.schema).toBeTypeOf("object");
  });

  it("falls back to the legacy extract format, still as a string", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("no json format on this plan", { status: 400 }))
      .mockResolvedValueOnce(Response.json({ success: true, data: { extract: { title: "A Book" } } }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();

    const { extractAmazonMetadata } = await import("../lib/firecrawl");
    const result = await extractAmazonMetadata("https://www.amazon.com/dp/B0TEST0000");

    expect(result.title).toBe("A Book");
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(secondBody.formats).toEqual(["extract"]);
    expect(secondBody.extract.schema).toBeTypeOf("object");
  });

  it("does not start the fallback attempt once its time is gone", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return new Response("upstream error", { status: 502 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();

    const { extractAmazonMetadata } = await import("../lib/firecrawl");
    await extractAmazonMetadata("https://www.amazon.com/dp/B0TEST0000", 100);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
