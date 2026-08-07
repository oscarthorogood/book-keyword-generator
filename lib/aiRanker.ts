import { KeywordCandidate } from "./types";

/**
 * Final AI-judged pass over the heuristically pre-filtered keyword
 * shortlist. The heuristic scorer (scoreAndTierBids in lib/keywordMerge.ts)
 * narrows hundreds of raw candidates down to a shortlist first — this only
 * ever sees that shortlist, not the raw pool, to keep the call small, cheap,
 * and fast, and to keep a clean fallback path (the heuristic's own order)
 * if the AI call fails or isn't configured.
 *
 * Uses Google Gemini's free tier (aistudio.google.com — no credit card,
 * generous daily limits) rather than a paid API, per the "keep this free"
 * constraint the rest of the app follows. Request/response shape is written
 * against Gemini's documented generateContent + responseSchema contract but
 * unverified against a live call from this environment (network-restricted
 * sandbox) — verify after deploy, and fails soft to null (never blocks the
 * export) on any error.
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
  return !!GEMINI_API_KEY;
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
 * Sends the pre-filtered shortlist to Gemini for a final relevance pass.
 * Returns null (triggering the caller's heuristic-only fallback) if Gemini
 * isn't configured, the call fails, or the response doesn't parse — never
 * throws.
 */
export async function rankKeywordsWithAi(
  context: BookContext,
  tropesShortlist: KeywordCandidate[],
  compNamesShortlist: KeywordCandidate[]
): Promise<AiRankedKeyword[] | null> {
  if (!GEMINI_API_KEY) return null;

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
    console.error("[rankKeywordsWithAi] failed:", err instanceof Error ? err.message : err);
    return null;
  }
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
