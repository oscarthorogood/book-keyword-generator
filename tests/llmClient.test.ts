/**
 * OpenRouter client (lib/llmClient.ts) plus the two behaviours built on top of
 * it that had real accuracy costs: the persona prompt being genre-agnostic
 * rather than hardcoded to crime fiction, and the AI ranking pass judging its
 * shortlist in chunks instead of one truncated call.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyIntentSegment,
  describeReaderPersona,
  extractPersonaQueries,
  personaQueriesToCandidates,
} from "../lib/personaPrompt";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

/** A 200 response carrying `content`, in OpenRouter's chat-completion shape. */
function okResponse(content: string, model = "deepseek/deepseek-chat-v3-0324:free") {
  return { ok: true, json: async () => ({ model, choices: [{ message: { content } }] }) };
}

function errorResponse(status: number) {
  return {
    ok: false,
    status,
    statusText: "Error",
    headers: { get: () => null },
    text: async () => "upstream said no",
  };
}

describe("openRouterModelChain", () => {
  it("defaults to a real published model slug, not the unroutable openrouter/free", async () => {
    delete process.env.OPENROUTER_MODEL;
    delete process.env.OPENROUTER_FALLBACK_MODELS;
    const { openRouterModelChain } = await import("../lib/llmClient");

    const chain = openRouterModelChain();
    expect(chain[0]).toBe("deepseek/deepseek-chat-v3-0324:free");
    expect(chain).not.toContain("openrouter/free");
    expect(chain.length).toBeGreaterThan(1);
  });

  it("takes the model and fallbacks from the environment when set", async () => {
    process.env.OPENROUTER_MODEL = "anthropic/claude-x";
    process.env.OPENROUTER_FALLBACK_MODELS = "a/b, c/d";
    const { openRouterModelChain } = await import("../lib/llmClient");

    expect(openRouterModelChain()).toEqual(["anthropic/claude-x", "a/b", "c/d"]);
  });

  it("dedupes so a model named as both preference and fallback is not tried twice", async () => {
    const { openRouterModelChain } = await import("../lib/llmClient");
    expect(openRouterModelChain("a/b", ["a/b", "c/d"])).toEqual(["a/b", "c/d"]);
  });
});

describe("callOpenRouter", () => {
  it("retries a 429 on the same model before moving on", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(okResponse("hello"));
    vi.stubGlobal("fetch", mockFetch);

    const { callOpenRouter, clearOpenRouterCache } = await import("../lib/llmClient");
    clearOpenRouterCache();

    const result = await callOpenRouter([{ role: "user", content: "hi" }], { logger: () => {}, cacheTtlMs: 0 });

    expect(result.text).toBe("hello");
    expect(result.attempts).toBe(2);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Same model both times — a 429 means "wait", not "this model is wrong".
    const [firstBody, secondBody] = mockFetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(secondBody.model).toBe(firstBody.model);
  });

  it("moves straight to the next model on a non-retryable status", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(404))
      .mockResolvedValueOnce(okResponse("hello", "meta-llama/llama-3.3-70b-instruct:free"));
    vi.stubGlobal("fetch", mockFetch);

    const { callOpenRouter, clearOpenRouterCache } = await import("../lib/llmClient");
    clearOpenRouterCache();

    await callOpenRouter([{ role: "user", content: "hi" }], { logger: () => {}, cacheTtlMs: 0 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [firstBody, secondBody] = mockFetch.mock.calls.map((call) => JSON.parse(call[1].body));
    expect(secondBody.model).not.toBe(firstBody.model);
  });

  it("treats a 200 carrying an error envelope as a failure of that model", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: { message: "no capacity" } }) })
      .mockResolvedValueOnce(okResponse("hello"));
    vi.stubGlobal("fetch", mockFetch);

    const { callOpenRouter, clearOpenRouterCache } = await import("../lib/llmClient");
    clearOpenRouterCache();

    await expect(
      callOpenRouter([{ role: "user", content: "hi" }], { logger: () => {}, cacheTtlMs: 0 })
    ).resolves.toMatchObject({ text: "hello" });
  });

  it("serves an identical prompt from cache instead of paying for it twice", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    const mockFetch = vi.fn().mockResolvedValue(okResponse("hello"));
    vi.stubGlobal("fetch", mockFetch);

    const { callOpenRouter, clearOpenRouterCache } = await import("../lib/llmClient");
    clearOpenRouterCache();

    const messages = [{ role: "user" as const, content: "same question" }];
    const first = await callOpenRouter(messages, { logger: () => {} });
    const second = await callOpenRouter(messages, { logger: () => {} });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.text).toBe("hello");
  });

  it("throws when the key is missing rather than sending an unauthenticated request", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { callOpenRouter } = await import("../lib/llmClient");
    await expect(callOpenRouter([{ role: "user", content: "hi" }])).rejects.toThrow(/not configured/);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("parseJsonLoose", () => {
  it("reads JSON out of a fenced block, a bare object, or a sentence wrapping one", async () => {
    const { parseJsonLoose } = await import("../lib/llmClient");
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 });
    expect(parseJsonLoose('Sure! {"a":1} hope that helps')).toEqual({ a: 1 });
    expect(parseJsonLoose("not json at all")).toBeNull();
  });
});

describe("describeReaderPersona", () => {
  it("derives the persona from the book's own genre rather than assuming crime fiction", () => {
    expect(describeReaderPersona(["romance", "enemies to lovers"])).toBe("a romance reader");
    expect(describeReaderPersona(["epic fantasy", "dragons"])).toBe("a fantasy reader");
    expect(describeReaderPersona([], ["Books > Cookbooks, Food & Wine > Baking"])).toBe(
      "a home cook browsing cookbooks"
    );
    expect(describeReaderPersona(["police procedural"])).toBe("a crime-fiction reader");
  });

  it("falls back to a neutral buyer instead of guessing a genre it has no evidence for", () => {
    expect(describeReaderPersona([], [])).toBe("a book buyer");
    expect(describeReaderPersona(["widget collecting"])).toBe("a reader who buys widget collecting books");
  });
});

describe("persona query parsing", () => {
  it("accepts the JSON shape, a bare string list, and a plain newline block", () => {
    expect(extractPersonaQueries({ queries: [{ q: "cozy mystery", segment: "genre-core" }] })).toEqual([
      { text: "cozy mystery", segment: "genre-core" },
    ]);
    expect(extractPersonaQueries({ queries: ["cozy mystery"] })).toEqual([{ text: "cozy mystery" }]);
    expect(extractPersonaQueries(null, "1. cozy mystery\n- small town sleuth")).toEqual([
      { text: "cozy mystery" },
      { text: "small town sleuth" },
    ]);
  });

  it("keeps a valid segment label from the model and heuristically classifies the rest", () => {
    const candidates = personaQueriesToCandidates(
      [
        { text: "Unforgiven Jacqueline New", segment: "not-a-segment" },
        { text: "val mcdermid books", segment: "comp-author" },
        { text: "unforgiven jacqueline new" },
      ],
      "persona-llm",
      { title: "Unforgiven", author: "Jacqueline New" },
      ["Val McDermid"],
      []
    );

    // Third entry normalizes to the same text as the first and is deduped.
    expect(candidates).toHaveLength(2);
    expect(candidates[0].intentSegment).toBe("alpha-core");
    expect(candidates[1].intentSegment).toBe("comp-author");
    expect(candidates.every((c) => c.sources.includes("persona-llm"))).toBe(true);
  });

  it("classifyIntentSegment tolerates empty comp lists", () => {
    expect(classifyIntentSegment("gritty noir", { title: "X" })).toBe("mood-setting");
  });
});

describe("rankKeywordsWithAi", () => {
  const context = { title: "Unforgiven", author: "Jacqueline New", genreTerms: ["crime"] };

  function shortlist(size: number) {
    return Array.from({ length: size }, (_, i) => ({ text: `keyword ${i}`, sources: ["autocomplete" as const] }));
  }

  it("splits the shortlist into chunks instead of one call that comes back truncated", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;

    const mockFetch = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      const asked = String(body.messages[1].content).match(/^- "/gm)?.length ?? 0;
      const keywords = Array.from({ length: asked }, (_, i) => ({ text: `k${i}`, category: "tropes", score: 50 }));
      return Promise.resolve(okResponse(JSON.stringify({ keywords })));
    });
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const { clearOpenRouterCache } = await import("../lib/llmClient");
    clearOpenRouterCache();

    const ranked = await rankKeywordsWithAi(context, shortlist(120), [], { chunkSize: 50 });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(ranked).toHaveLength(120);

    // Each request asks for enough response tokens to actually fit its
    // verdicts — the old single call inherited an 800-token default.
    for (const call of mockFetch.mock.calls) {
      const body = JSON.parse(String(call[1].body));
      expect(body.max_tokens).toBeGreaterThan(1000);
      expect(body.temperature).toBeLessThanOrEqual(0.2);
    }
  });

  it("keeps the verdicts from the chunks that succeeded when one fails", async () => {
    process.env.OPENROUTER_API_KEY = "test-key";
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;

    let call = 0;
    const mockFetch = vi.fn().mockImplementation(() => {
      call += 1;
      // First chunk's model chain exhausts itself; the second answers.
      return Promise.resolve(call <= 4 ? errorResponse(400) : okResponse(JSON.stringify({ keywords: [{ text: "k0", category: "tropes", score: 90 }] })));
    });
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const { clearOpenRouterCache } = await import("../lib/llmClient");
    clearOpenRouterCache();

    const ranked = await rankKeywordsWithAi(context, shortlist(4), [], { chunkSize: 2, concurrency: 1 });
    expect(ranked).toEqual([{ text: "k0", category: "tropes", score: 90 }]);
  });

  it("returns null when no provider is configured, so the heuristic order stands", async () => {
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.GROQ_API_KEY;

    const { rankKeywordsWithAi, isAiRankingConfigured } = await import("../lib/aiRanker");
    expect(isAiRankingConfigured()).toBe(false);
    expect(await rankKeywordsWithAi(context, shortlist(3), [])).toBeNull();
  });
});
