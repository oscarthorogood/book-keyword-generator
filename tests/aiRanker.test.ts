/**
 * lib/aiRanker.ts's final relevance pass tries Gemini first, then falls
 * back to OpenRouter (lib/llmClient.ts — the same free-tier chat client
 * lib/llmPersonaSource.ts uses) when Gemini isn't configured or its call
 * fails. Both env vars are read at module load time, so every test here
 * sets process.env before a dynamic import, the same pattern
 * tests/newKeywordSources.test.ts uses for llmPersonaSource.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { KeywordCandidate } from "../lib/types";

const originalGeminiKey = process.env.GEMINI_API_KEY;
const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;

const BOOK_CONTEXT = { title: "Unforgiven", author: "Jacqueline New", genreTerms: ["crime thriller"] };
const TROPES: KeywordCandidate[] = [{ text: "scottish crime thriller", sources: ["genre-metadata"] }];
const COMPS: KeywordCandidate[] = [{ text: "val mcdermid books", sources: ["comp-name"] }];

beforeEach(() => {
  vi.resetModules();
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  if (originalGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalGeminiKey;
  if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
  vi.unstubAllGlobals();
});

describe("isAiRankingConfigured", () => {
  it("is false when neither GEMINI_API_KEY nor OPENROUTER_API_KEY is set", async () => {
    const { isAiRankingConfigured } = await import("../lib/aiRanker");
    expect(isAiRankingConfigured()).toBe(false);
  });

  it("is true with only GEMINI_API_KEY set", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    const { isAiRankingConfigured } = await import("../lib/aiRanker");
    expect(isAiRankingConfigured()).toBe(true);
  });

  it("is true with only OPENROUTER_API_KEY set", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const { isAiRankingConfigured } = await import("../lib/aiRanker");
    expect(isAiRankingConfigured()).toBe(true);
  });
});

describe("rankKeywordsWithAi", () => {
  it("returns null when neither provider is configured, without calling fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const result = await rankKeywordsWithAi(BOOK_CONTEXT, TROPES, COMPS);

    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to OpenRouter when GEMINI_API_KEY is unset", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: "deepseek/deepseek-chat-v3-0324:free",
        choices: [
          {
            message: {
              content: JSON.stringify({
                keywords: [
                  { text: "scottish crime thriller", category: "tropes", score: 88 },
                  { text: "val mcdermid books", category: "comp-names", score: 76 },
                ],
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const result = await rankKeywordsWithAi(BOOK_CONTEXT, TROPES, COMPS);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(result).toEqual([
      { text: "scottish crime thriller", category: "tropes", score: 88 },
      { text: "val mcdermid books", category: "comp-names", score: 76 },
    ]);
  });

  it("parses an OpenRouter response wrapped in a ```json fence", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const fenced = "```json\n" + JSON.stringify({ keywords: [{ text: "scottish crime thriller", category: "tropes", score: 90 }] }) + "\n```";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: fenced } }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const result = await rankKeywordsWithAi(BOOK_CONTEXT, TROPES, COMPS);

    expect(result).toEqual([{ text: "scottish crime thriller", category: "tropes", score: 90 }]);
  });

  it("falls back to OpenRouter when the Gemini call fails", async () => {
    process.env.GEMINI_API_KEY = "gemini-key";
    process.env.OPENROUTER_API_KEY = "or-key";

    const mockFetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("generativelanguage.googleapis.com")) {
        return Promise.resolve({ ok: false, status: 500, statusText: "Internal Server Error" });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: JSON.stringify({ keywords: [{ text: "scottish crime thriller", category: "tropes", score: 70 }] }) } },
          ],
        }),
      });
    });
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const result = await rankKeywordsWithAi(BOOK_CONTEXT, TROPES, COMPS);

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(result).toEqual([{ text: "scottish crime thriller", category: "tropes", score: 70 }]);
  });

  it("returns null when OpenRouter's response never parses as JSON", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "sorry, I can't help with that" } }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const result = await rankKeywordsWithAi(BOOK_CONTEXT, TROPES, COMPS);

    expect(result).toBeNull();
  });

  it("returns [] without calling fetch when the shortlist is empty", async () => {
    process.env.OPENROUTER_API_KEY = "or-key";
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const { rankKeywordsWithAi } = await import("../lib/aiRanker");
    const result = await rankKeywordsWithAi(BOOK_CONTEXT, [], []);

    expect(result).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// The verdict list is untrusted model output: it can name the same candidate
// more than once, and can answer with something other than the array the
// schema asked for.
describe("mergeAiRanking with repeated verdicts", () => {
  it("keeps one entry per candidate when the model names it twice", async () => {
    const { mergeAiRanking } = await import("../lib/aiRanker");
    const pool: KeywordCandidate[] = [
      { text: "scottish crime thriller", sources: ["genre-metadata"] },
      { text: "tartan noir books", sources: ["genre-metadata"] },
    ];
    const merged = mergeAiRanking(
      pool,
      [
        { text: "scottish crime thriller", category: "tropes", score: 90 },
        { text: "scottish crime thriller", category: "tropes", score: 70 },
        { text: "tartan noir books", category: "tropes", score: 80 },
      ],
      "tropes",
      10
    );

    expect(merged.map((c) => c.text)).toEqual(["scottish crime thriller", "tartan noir books"]);
    // First verdict wins, so the repeat doesn't quietly rescore it either.
    expect(merged[0].score).toBe(90);
  });

  it("does not let a repeated verdict eat another candidate's capped slot", async () => {
    const { mergeAiRanking } = await import("../lib/aiRanker");
    const pool: KeywordCandidate[] = [
      { text: "a", sources: ["genre-metadata"] },
      { text: "b", sources: ["genre-metadata"] },
    ];
    const merged = mergeAiRanking(
      pool,
      [
        { text: "a", category: "tropes", score: 90 },
        { text: "a", category: "tropes", score: 89 },
        { text: "b", category: "tropes", score: 88 },
      ],
      "tropes",
      2
    );

    expect(merged.map((c) => c.text)).toEqual(["a", "b"]);
  });
});
