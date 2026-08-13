import { callOpenRouter, isOpenRouterConfigured, parseJsonLoose } from "./llmClient";
import { callGroq, isGroqConfigured } from "./groqClient";
import { mapWithConcurrency } from "./concurrency";
import { KeywordCandidate } from "./types";

/**
 * Final AI-judged pass over the heuristically pre-filtered keyword
 * shortlist. The heuristic scorer (scoreAndTierBids in lib/keywordMerge.ts)
 * narrows hundreds of raw candidates down to a shortlist first — this only
 * ever sees that shortlist, not the raw pool, to keep the calls cheap and to
 * keep a clean fallback path (the heuristic's own order) if the AI pass fails
 * or isn't configured.
 *
 * The shortlist is judged in *chunks* rather than one request. A single call
 * covering the whole list reliably came back truncated — models stop
 * emitting well before the last candidate — and a truncated JSON body fails
 * to parse, which threw away the entire pass. Chunking bounds each response,
 * lets the chunks run in parallel, and degrades to a partial verdict set
 * (anything unjudged keeps its heuristic position) instead of nothing.
 *
 * Provider order defaults to Gemini → OpenRouter → Groq: Gemini's free tier
 * (aistudio.google.com — no credit card, generous daily limits) first, per
 * the "keep this free" constraint the rest of the app follows. Set
 * `AI_RANKER_PROVIDER_ORDER` (e.g. `openrouter,groq,gemini`) to change it.
 * Every leg fails soft to null and never blocks the export.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

/**
 * Candidates per request. Sized so a chunk's JSON verdict list fits inside
 * the response token budget with room to spare on the free models.
 */
export const AI_RANK_CHUNK_SIZE = 55;
/** Chunks in flight at once — enough to hide latency without tripping free-tier rate limits. */
const AI_RANK_CONCURRENCY = 4;
/** Wall-clock ceiling for one provider's whole set of chunks; the route has a 60s serverless timeout. */
const AI_RANK_BUDGET_MS = 35_000;
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
 * honour JSON mode inconsistently, so they're prompted to return JSON only
 * but sometimes still wrap it in a ```json fence or add a stray sentence —
 * parseJsonLoose (lib/llmClient.ts) handles both shapes.
 */
function parseRankedKeywordsJson(text: string): AiRankedKeyword[] | null {
  const parsed = parseJsonLoose<{ keywords?: AiRankedKeyword[] } | AiRankedKeyword[]>(text);
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed;
  // `keywords` is whatever the model actually emitted, not necessarily the
  // array the schema asked for. Returning a non-array here reached
  // applyAiRelevance, which calls .map on it — a model answering
  // {"keywords": "none"} would take the generate route down with a TypeError.
  return Array.isArray(parsed.keywords) ? parsed.keywords : null;
}

/** Response-token budget for one chunk: enough for a verdict object per candidate, plus slack. */
function chunkMaxTokens(candidateCount: number): number {
  return Math.min(8192, Math.max(1500, candidateCount * 60));
}

const JSON_RANKER_SYSTEM_PROMPT =
  "You are an Amazon Sponsored Products keyword relevance judge. Respond with ONLY a JSON object, no commentary and no markdown code fence.";

const JSON_RANKER_SHAPE_INSTRUCTION =
  'Respond with exactly this JSON shape: {"keywords": [{"text": string, "category": "tropes" | "comp-names" | "drop", "score": integer 0-100}, ...]}';

/** OpenRouter/Groq structured-output schema, mirroring RESPONSE_SCHEMA's Gemini form. */
const JSON_RANKER_SCHEMA = {
  name: "keyword_verdicts",
  schema: {
    type: "object",
    properties: {
      keywords: {
        type: "array",
        items: {
          type: "object",
          properties: {
            text: { type: "string" },
            category: { type: "string", enum: ["tropes", "comp-names", "drop"] },
            score: { type: "integer" },
          },
          required: ["text", "category", "score"],
        },
      },
    },
    required: ["keywords"],
  },
};

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
 * OpenRouter leg of rankKeywordsWithAi (lib/llmClient.ts). Asks for
 * structured output via `response_format` — honoured by most models and
 * ignored by the rest — and parses leniently either way.
 *
 * Previously this called `callOpenRouter` with no options at all, which meant
 * the client's defaults applied: `max_tokens: 800` and `temperature: 0.8`.
 * 800 tokens is nowhere near enough for a verdict per candidate, so the JSON
 * came back truncated and unparseable on essentially every run, and 0.8 is
 * the wrong temperature for a judge. Both are now set explicitly, and the
 * chunk size keeps each response comfortably inside the budget.
 */
async function rankWithOpenRouter(prompt: string, candidateCount: number): Promise<AiRankedKeyword[] | null> {
  if (!isOpenRouterConfigured()) return null;

  try {
    const { text } = await callOpenRouter(
      [
        { role: "system", content: JSON_RANKER_SYSTEM_PROMPT },
        { role: "user", content: `${prompt}\n\n${JSON_RANKER_SHAPE_INSTRUCTION}` },
      ],
      {
        temperature: 0.1,
        maxTokens: chunkMaxTokens(candidateCount),
        responseFormat: { type: "json_schema", json_schema: { name: JSON_RANKER_SCHEMA.name, strict: false, schema: JSON_RANKER_SCHEMA.schema } },
        // One chunk is one slice of a parallel pass, so it gets a tight
        // budget: better to leave a chunk unjudged (its candidates keep their
        // heuristic order) than to spend the route's whole timeout on it.
        timeoutMs: 15_000,
        attemptsPerModel: 1,
        budgetMs: 20_000,
        label: "ai-ranker",
      }
    );

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
 * Groq leg of rankKeywordsWithAi — Groq's fast LLaMA inference, same JSON
 * prompt/response contract as the OpenRouter leg.
 */
async function rankWithGroq(prompt: string, candidateCount: number): Promise<AiRankedKeyword[] | null> {
  if (!isGroqConfigured()) return null;

  try {
    const { text } = await callGroq(
      [
        { role: "system", content: JSON_RANKER_SYSTEM_PROMPT },
        { role: "user", content: `${prompt}\n\n${JSON_RANKER_SHAPE_INSTRUCTION}` },
      ],
      { temperature: 0.1, maxTokens: chunkMaxTokens(candidateCount), responseFormat: { type: "json_object" } }
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

type RankCandidate = { text: string; category: "tropes" | "comp-names"; semantic?: KeywordSemantic };

interface RankProvider {
  id: "gemini" | "openrouter" | "groq";
  configured: () => boolean;
  run: (prompt: string, candidateCount: number) => Promise<AiRankedKeyword[] | null>;
}

const RANK_PROVIDERS: RankProvider[] = [
  { id: "gemini", configured: () => !!GEMINI_API_KEY, run: (prompt) => rankWithGemini(prompt) },
  { id: "openrouter", configured: isOpenRouterConfigured, run: rankWithOpenRouter },
  { id: "groq", configured: isGroqConfigured, run: rankWithGroq },
];

/**
 * Provider order, `AI_RANKER_PROVIDER_ORDER`-overridable (comma-separated
 * ids). Unconfigured providers are dropped; unrecognised ids are ignored, and
 * any provider the env list omits is appended so a typo can't silently
 * disable the whole pass.
 */
function orderedProviders(): RankProvider[] {
  const requested = (process.env.AI_RANKER_PROVIDER_ORDER ?? "")
    .split(",")
    .map((id) => id.trim().toLowerCase())
    .filter(Boolean);

  const byPreference = [
    ...requested.map((id) => RANK_PROVIDERS.find((p) => p.id === id)).filter((p): p is RankProvider => !!p),
    ...RANK_PROVIDERS,
  ];

  const seen = new Set<string>();
  return byPreference.filter((provider) => {
    if (seen.has(provider.id) || !provider.configured()) return false;
    seen.add(provider.id);
    return true;
  });
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Sends the pre-filtered shortlist to an LLM for a final relevance pass, in
 * parallel chunks (see AI_RANK_CHUNK_SIZE). Walks the configured providers in
 * order and returns the first one that produced any verdicts at all;
 * candidates whose chunk failed simply go unjudged and keep their heuristic
 * position. Returns null (triggering the caller's heuristic-only fallback) if
 * no provider is configured or every chunk of every provider failed — never
 * throws.
 */
export async function rankKeywordsWithAi(
  context: BookContext,
  tropesShortlist: KeywordCandidate[],
  compNamesShortlist: KeywordCandidate[],
  options: { chunkSize?: number; concurrency?: number; budgetMs?: number } = {}
): Promise<AiRankedKeyword[] | null> {
  const candidates: RankCandidate[] = [
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

  const chunks = chunk(candidates, Math.max(1, options.chunkSize ?? AI_RANK_CHUNK_SIZE));
  const concurrency = Math.max(1, options.concurrency ?? AI_RANK_CONCURRENCY);
  const budgetMs = options.budgetMs ?? AI_RANK_BUDGET_MS;

  for (const provider of orderedProviders()) {
    const deadline = Date.now() + budgetMs;
    const perChunk = await mapWithConcurrency(chunks, concurrency, async (group) => {
      if (Date.now() >= deadline) return null;
      return provider.run(buildPrompt(context, group), group.length);
    });

    const verdicts = perChunk.filter((result): result is AiRankedKeyword[] => !!result).flat();
    if (verdicts.length > 0) {
      const failed = perChunk.filter((result) => !result).length;
      if (failed > 0) {
        console.error(
          `[rankKeywordsWithAi] ${provider.id} judged ${chunks.length - failed}/${chunks.length} chunks; the rest keep their heuristic order`
        );
      }
      return verdicts;
    }
  }

  return null;
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
  // A model can name the same candidate twice in one verdict list. Each
  // mention resolved to the same pool entry, so the keyword shipped into the
  // final list more than once, taking a slot under the cap each time.
  const seen = new Set<string>();

  for (const r of ranked) {
    if (r.category !== category) continue;
    const base = byText.get(r.text);
    if (!base) continue; // AI referenced text outside the shortlist — ignore rather than trust it blindly
    if (seen.has(r.text)) continue; // first verdict wins
    seen.add(r.text);
    merged.push({ ...base, score: r.score });
  }

  return merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, cap);
}
