import { callOpenRouter, isOpenRouterConfigured } from "./llmClient";
import { callGroq, isGroqConfigured } from "./groqClient";
import { KeywordCandidate } from "./types";

/**
 * Final AI-judged pass over the heuristically pre-filtered keyword
 * shortlist. The heuristic scorer (scoreAndTierBids in lib/keywordMerge.ts)
 * narrows hundreds of raw candidates down to a shortlist first — this only
 * ever sees that shortlist, not the raw pool, to keep the call small, cheap,
 * and fast, and to keep a clean fallback path (the heuristic's own order)
 * if the AI call fails or isn't configured.
 *
 * Tries Google Gemini's free tier (aistudio.google.com — no credit card,
 * generous daily limits) first, per the "keep this free" constraint the rest
 * of the app follows. Request/response shape is written against Gemini's
 * documented generateContent + responseSchema contract.
 *
 * If Gemini isn't configured (no `GEMINI_API_KEY`) or its call fails, falls
 * back to OpenRouter (lib/llmClient.ts). If OpenRouter also isn't configured
 * or fails, falls back to Groq (lib/groqClient.ts). Either path fails soft
 * to null (never blocks the export) on any error.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
// Fast/cheap model, well within the free tier's rate limits for a
// single-user tool. Google's model lineup moves fast — if this 404s, check
// aistudio.google.com for the current Flash model name.
const GEMINI_MODEL = "gemini-2.0-flash";
const GEMINI_TIMEOUT_MS = 20000;
const MAX_DESCRIPTION_CONTEXT_CHARS = 1500;
const MAX_MARKDOWN_CONTEXT_CHARS = 6000;

export function isAiRankingConfigured(): boolean {
  return !!GEMINI_API_KEY || isOpenRouterConfigured() || isGroqConfigured();
}

export type AiKeywordCategory = "tropes" | "comp-names" | "drop";

export interface AiRankedKeyword {
  text: string;
  category: AiKeywordCategory;
  score: number;
}

export interface BookContext {
  title: string;
  author: string;
  seriesName?: string;
  genreTerms: string[];
  description?: string;
  /** Optional Firecrawl markdown excerpt of the book's own product page — see lib/firecrawl.ts. */
  pageMarkdown?: string;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export type KeywordSemantic =
  | "core-genre"
  | "sub-genre"
  | "competing-authors"
  | "comp-titles"
  | "series-names"
  | "character-tropes"
  | "relationship-tropes"
  | "plot-devices"
  | "setting-aesthetic"
  | "format"
  | "age-demographic"
  | "gift"
  | "problem-solving"
  | "skill-goal"
  | "mood-tone"
  | "award-bestseller"
  | "time-period"
  | "identity-cultural"
  | "synonym-alt"
  | "seasonal-holiday";

function buildPrompt(
  context: BookContext,
  candidates: { text: string; category: "tropes" | "comp-names"; semantic?: KeywordSemantic }[]
): string {
  const contextLines = [
    `Title: ${context.title}`,
    `Author: ${context.author}`,
    context.seriesName ? `Series: ${context.seriesName}` : null,
    context.genreTerms.length ? `Known genre/subject terms: ${context.genreTerms.join(", ")}` : null,
    context.description ? `Description: ${context.description.slice(0, MAX_DESCRIPTION_CONTEXT_CHARS)}` : null,
    context.pageMarkdown
      ? `Product page excerpt:\n${context.pageMarkdown.slice(0, MAX_MARKDOWN_CONTEXT_CHARS)}`
      : null,
  ]
    .filter((line): line is string => !!line)
    .join("\n");

  const candidateLines = candidates
    .map((c) => {
      const semanticLabel = c.semantic ? ` [${c.semantic}]` : "";
      return `- "${c.text}" (currently bucketed: ${c.category}${semanticLabel})`;
    })
    .join("\n");

  return `You are helping choose Amazon Sponsored Products keywords for a book, to maximize ad relevance and the likelihood a search leads to a sale.

Book context:
${contextLines}

Candidate keywords/phrases below were gathered from multiple free sources (autocomplete sweeps, comparable-title crawling, review-language mining, genre metadata, synonym expansion, etc). Some are noisy, too generic, or irrelevant to this specific book. For EACH candidate, decide:
- category: "tropes" (a thematic/genre/buyer-intent search phrase a reader might type), "comp-names" (a specific comparable author or book title someone would search by name — reclassify into this if a "tropes" candidate is actually a name), or "drop" (irrelevant, too generic, nonsensical, or unlikely to lead to a sale of this specific book)
- score: 0-100, how likely this exact phrase is to be searched by a reader who would go on to buy THIS book

Note: Some candidates include semantic category hints (e.g., [character-tropes], [plot-devices]) indicating what type of keyword intent we believe they represent. Use this context to better assess relevance, but trust the actual text of the keyword over any category hint.

Candidates:
${candidateLines}

Return every candidate exactly once, using its exact original text.`;
}

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    keywords: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          text: { type: "STRING" },
          category: { type: "STRING", enum: ["tropes", "comp-names", "drop"] },
          score: { type: "INTEGER" },
        },
        required: ["text", "category", "score"],
      },
    },
  },
  required: ["keywords"],
};

/**
 * Extracts a `{ "keywords": [...] }` payload from free text. Gemini's
 * `responseSchema` guarantees bare JSON; OpenRouter's and Groq's free models
 * don't, so they're prompted to return JSON only but sometimes still wrap it
 * in a ```json fence or add a stray sentence — strip a fence if present, then
 * fall back to the first `{...}` block in the text before giving up.
 */
function parseRankedKeywordsJson(text: string): AiRankedKeyword[] | null {
  const unfenced = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const candidates = [unfenced, unfenced.match(/\{[\s\S]*\}/)?.[0]].filter((value): value is string => !!value);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { keywords?: AiRankedKeyword[] };
      if (parsed.keywords) return parsed.keywords;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/** Gemini leg of rankKeywordsWithAi — its documented generateContent + responseSchema contract. */
async function rankWithGemini(prompt: string): Promise<AiRankedKeyword[] | null> {
  if (!GEMINI_API_KEY) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      },
      GEMINI_TIMEOUT_MS
    );

    if (!res.ok) {
      console.error(`[rankKeywordsWithAi] Gemini HTTP ${res.status}`);
      return null;
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.error("[rankKeywordsWithAi] Gemini response had no text part");
      return null;
    }

    const parsed = JSON.parse(text) as { keywords?: AiRankedKeyword[] };
    return parsed.keywords ?? [];
  } catch (err) {
    console.error("[rankKeywordsWithAi] Gemini call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * OpenRouter leg of rankKeywordsWithAi (lib/llmClient.ts) — the fallback
 * when Gemini isn't configured or its call failed. Same prompt, but since
 * OpenRouter's free models have no structured-output contract to lean on,
 * the instruction to return bare JSON is spelled out and the response is
 * parsed leniently by parseRankedKeywordsJson.
 */
async function rankWithOpenRouter(prompt: string): Promise<AiRankedKeyword[] | null> {
  if (!isOpenRouterConfigured()) return null;

  try {
    const { text } = await callOpenRouter([
      {
        role: "system",
        content:
          "You are an Amazon Sponsored Products keyword relevance judge. Respond with ONLY a JSON object, no commentary and no markdown code fence.",
      },
      {
        role: "user",
        content: `${prompt}\n\nRespond with exactly this JSON shape: {"keywords": [{"text": string, "category": "tropes" | "comp-names" | "drop", "score": integer 0-100}, ...]}`,
      },
    ]);

    const parsed = parseRankedKeywordsJson(text);
    if (!parsed) {
      console.error("[rankKeywordsWithAi] OpenRouter response did not parse as the expected JSON shape");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("[rankKeywordsWithAi] OpenRouter call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Groq leg of rankKeywordsWithAi — the final fallback when both Gemini and
 * OpenRouter aren't configured or failed. Uses Groq's fast LLaMA inference.
 * Same JSON prompt/response contract as the OpenRouter leg.
 */
async function rankWithGroq(prompt: string): Promise<AiRankedKeyword[] | null> {
  if (!isGroqConfigured()) return null;

  try {
    const { text } = await callGroq(
      [
        {
          role: "system",
          content:
            "You are an Amazon Sponsored Products keyword relevance judge. Respond with ONLY a JSON object, no commentary and no markdown code fence.",
        },
        {
          role: "user",
          content: `${prompt}\n\nRespond with exactly this JSON shape: {"keywords": [{"text": string, "category": "tropes" | "comp-names" | "drop", "score": integer 0-100}, ...]}`,
        },
      ],
      { temperature: 0.1, maxTokens: 4096 }
    );

    const parsed = parseRankedKeywordsJson(text);
    if (!parsed) {
      console.error("[rankKeywordsWithAi] Groq response did not parse as the expected JSON shape");
      return null;
    }
    return parsed;
  } catch (err) {
    console.error("[rankKeywordsWithAi] Groq call failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Sends the pre-filtered shortlist to an LLM for a final relevance pass:
 * Gemini first when `GEMINI_API_KEY` is set, falling back to OpenRouter
 * (lib/llmClient.ts) when Gemini isn't configured or its call fails, then
 * falling back to Groq (lib/groqClient.ts) as a final option. Returns null
 * (triggering the caller's heuristic-only fallback) if none are configured,
 * all calls fail, or the response doesn't parse — never throws.
 */
export async function rankKeywordsWithAi(
  context: BookContext,
  tropesShortlist: KeywordCandidate[],
  compNamesShortlist: KeywordCandidate[]
): Promise<AiRankedKeyword[] | null> {
  const candidates = [
    ...tropesShortlist.map((c) => ({
      text: c.text,
      category: "tropes" as const,
      semantic: c.category as KeywordSemantic | undefined,
    })),
    ...compNamesShortlist.map((c) => ({
      text: c.text,
      category: "comp-names" as const,
      semantic: c.category as KeywordSemantic | undefined,
    })),
  ];
  if (candidates.length === 0) return [];

  const prompt = buildPrompt(context, candidates);

  const geminiResult = await rankWithGemini(prompt);
  if (geminiResult) return geminiResult;

  const openRouterResult = await rankWithOpenRouter(prompt);
  if (openRouterResult) return openRouterResult;

  return rankWithGroq(prompt);
}

/**
 * Relevance pass that refines an order instead of replacing it. The AI sees a
 * long list and reliably omits some of it, so anything it doesn't mention
 * keeps its heuristic position at the back of the list rather than being
 * silently dropped — only an explicit "drop" verdict removes a candidate.
 * Use this when the goal is a full research list; use mergeAiRanking when the
 * goal is a small, strictly AI-chosen shortlist.
 */
export function applyAiRelevance(
  pool: KeywordCandidate[],
  ranked: AiRankedKeyword[]
): KeywordCandidate[] {
  const verdicts = new Map(ranked.map((r) => [r.text, r]));

  const judged: KeywordCandidate[] = [];
  const unjudged: KeywordCandidate[] = [];

  for (const candidate of pool) {
    const verdict = verdicts.get(candidate.text);
    if (!verdict) {
      unjudged.push(candidate);
      continue;
    }
    if (verdict.category === "drop") continue;
    judged.push({ ...candidate, score: verdict.score });
  }

  judged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  unjudged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return [...judged, ...unjudged];
}

/**
 * Maps the AI's category/score decisions back onto the original
 * KeywordCandidate objects (preserving sources/suggestedBid — the AI judges
 * relevance, it doesn't invent bid data), sorts by AI score, and caps.
 * Candidates the AI dropped (or didn't mention) are excluded. `pool` should
 * be the combined shortlist across both original buckets, since the AI can
 * reclassify a candidate from one category into the other.
 */
export function mergeAiRanking(
  pool: KeywordCandidate[],
  ranked: AiRankedKeyword[],
  category: "tropes" | "comp-names",
  cap: number
): KeywordCandidate[] {
  const byText = new Map(pool.map((c) => [c.text, c]));
  const merged: KeywordCandidate[] = [];

  for (const r of ranked) {
    if (r.category !== category) continue;
    const base = byText.get(r.text);
    if (!base) continue; // AI referenced text outside the shortlist — ignore rather than trust it blindly
    merged.push({ ...base, score: r.score });
  }

  return merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, cap);
}
