/**
 * OpenRouter chat-completion client. Fetch-based like every other external
 * call in this app (see lib/firecrawl.ts) — no SDK dependency for a handful
 * of calls.
 *
 * Three things beyond a bare `fetch` wrapper, all of which the generation
 * pipelines depend on:
 *
 *   1. A *model chain* rather than one model. Free-tier slugs come and go and
 *      are rate-limited per-model, so a call walks a list until one answers.
 *      The chain is env-overridable (`OPENROUTER_MODEL`,
 *      `OPENROUTER_FALLBACK_MODELS`) so a deployment can pin a paid model
 *      without a code change.
 *   2. Retries that distinguish "try again" from "try something else":
 *      429/5xx are retried on the same model with backoff (honouring
 *      `Retry-After`), everything else moves straight to the next model.
 *   3. Structured output. `responseFormat` maps to OpenRouter's
 *      `response_format`, and `callOpenRouterJson` parses leniently on top of
 *      it — free models honour JSON mode inconsistently, so the parse has to
 *      survive a code fence or a stray sentence either way.
 *
 * A small in-memory response cache dedupes identical prompts within a run
 * (the ranker chunks and the two persona sources can otherwise re-ask the
 * same question when a book is regenerated back-to-back).
 */

import { createHash } from "node:crypto";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_TIMEOUT_MS = 20_000;
/** Attempts per model before moving to the next one in the chain. */
const DEFAULT_ATTEMPTS_PER_MODEL = 2;
/**
 * Ceiling on one call's whole chain. Without it, retries × models × timeout
 * can outlast the 60s serverless limit the generate routes run under and take
 * the whole request down with them.
 */
const DEFAULT_BUDGET_MS = 35_000;
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_BACKOFF_MS = 8_000;
const CACHE_MAX_ENTRIES = 200;

/** Statuses worth retrying on the same model — everything else is a model/request problem. */
const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

function apiKey(): string | undefined {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? key : undefined;
}

export function isOpenRouterConfigured(): boolean {
  return !!apiKey();
}

/**
 * Default free-tier chain. `OPENROUTER_MODEL` overrides the first entry and
 * `OPENROUTER_FALLBACK_MODELS` (comma-separated) overrides the rest, so a
 * deployment with credit can point the whole pipeline at a stronger model.
 *
 * Note: the previous default here was `openrouter/free`, which is not a model
 * slug OpenRouter publishes — every call spent a failed request on it before
 * falling through to the real models below.
 */
export const DEFAULT_OPENROUTER_MODEL = "deepseek/deepseek-chat-v3-0324:free";

export const OPENROUTER_FALLBACK_MODELS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemini-2.0-flash-exp:free",
  // Router across whatever the account can reach — a useful last resort on a
  // key with credit, a no-op failure on a free-only key.
  "openrouter/auto",
];

function envList(name: string): string[] | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const values = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? values : undefined;
}

/**
 * The ordered model list one call will walk: the caller's preference first
 * (or `OPENROUTER_MODEL`), then the caller's fallbacks (or
 * `OPENROUTER_FALLBACK_MODELS`), deduped.
 */
export function openRouterModelChain(preferred?: string, fallbacks?: string[]): string[] {
  const first = preferred ?? envList("OPENROUTER_MODEL")?.[0] ?? DEFAULT_OPENROUTER_MODEL;
  const rest = fallbacks ?? envList("OPENROUTER_FALLBACK_MODELS") ?? OPENROUTER_FALLBACK_MODELS;
  return Array.from(new Set([first, ...rest]));
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** OpenRouter's `response_format`. `json_schema` is honoured by most models and ignored by the rest. */
export type ResponseFormat =
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> } };

export interface CallOpenRouterOptions {
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
  timeoutMs?: number;
  /** Attempts per model on retryable failures (default 3). */
  attemptsPerModel?: number;
  /** Response cache TTL. 0 disables caching for this call. */
  cacheTtlMs?: number;
  /** Wall-clock ceiling for the whole chain — a generate run has a serverless timeout to respect. */
  budgetMs?: number;
  /** Shows up in log lines so a failure can be traced to the source that made the call. */
  label?: string;
  logger?: (message: string) => void;
}

export interface CallOpenRouterResult {
  text: string;
  /** The model OpenRouter reports actually serving the request, not the one asked for. */
  model: string;
  cached: boolean;
  /** Total HTTP attempts across the chain, including the successful one. */
  attempts: number;
  promptTokens?: number;
  completionTokens?: number;
}

interface CacheEntry {
  expiresAt: number;
  result: CallOpenRouterResult;
}

const responseCache = new Map<string, CacheEntry>();

function cacheKey(model: string, messages: ChatMessage[], options: CallOpenRouterOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? null,
        maxTokens: options.maxTokens ?? null,
        responseFormat: options.responseFormat ?? null,
      })
    )
    .digest("hex");
}

function readCache(key: string): CallOpenRouterResult | undefined {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return { ...entry.result, cached: true };
}

function writeCache(key: string, result: CallOpenRouterResult, ttlMs: number): void {
  if (ttlMs <= 0) return;
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    // Oldest insertion first — Map preserves insertion order.
    const oldest = responseCache.keys().next();
    if (!oldest.done) responseCache.delete(oldest.value);
  }
  responseCache.set(key, { expiresAt: Date.now() + ttlMs, result: { ...result, cached: false } });
}

/** Test seam — the cache is process-global and would otherwise leak between cases. */
export function clearOpenRouterCache(): void {
  responseCache.clear();
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class OpenRouterHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
    message: string
  ) {
    super(message);
    this.name = "OpenRouterHttpError";
  }

  get retryable(): boolean {
    return RETRYABLE_STATUS.has(this.status);
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

async function requestOnce(
  model: string,
  messages: ChatMessage[],
  options: CallOpenRouterOptions
): Promise<CallOpenRouterResult> {
  const res = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        // OpenRouter's documented attribution headers — they identify the
        // calling app on the account's activity page.
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://github.com/oscarthorogood/book-keyword-generator",
        "X-Title": "Amazon Ads Assistant",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 800,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      }),
    },
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new OpenRouterHttpError(
      res.status,
      parseRetryAfter(res.headers.get("retry-after")),
      `OpenRouter request failed for model ${model}: ${res.status} ${res.statusText}${detail ? ` — ${detail.slice(0, 300)}` : ""}`
    );
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
    error?: { message?: string };
  };

  // OpenRouter can answer 200 with an error envelope when an upstream
  // provider rejects the request — treat that as a failure of this model
  // rather than as an empty completion.
  if (data.error?.message) {
    throw new OpenRouterHttpError(502, undefined, `OpenRouter returned an error for model ${model}: ${data.error.message}`);
  }

  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) {
    throw new OpenRouterHttpError(502, undefined, `OpenRouter returned an empty completion for model ${model}`);
  }

  return {
    text,
    model: data.model ?? model,
    cached: false,
    attempts: 1,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
  };
}

/**
 * Calls OpenRouter's chat-completion endpoint, walking the model chain and
 * retrying retryable failures on each model before moving on. Throws only if
 * every model in the chain fails — callers that must not throw (every keyword
 * source does) should catch and fail soft themselves.
 */
export async function callOpenRouter(
  messages: ChatMessage[],
  options: CallOpenRouterOptions = {}
): Promise<CallOpenRouterResult> {
  if (!isOpenRouterConfigured()) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const log = options.logger ?? ((message: string) => console.warn(message));
  const label = options.label ? `${options.label} ` : "";
  const models = openRouterModelChain(options.model, options.fallbackModels);
  const attemptsPerModel = Math.max(1, options.attemptsPerModel ?? DEFAULT_ATTEMPTS_PER_MODEL);
  const ttlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  let totalAttempts = 0;
  let lastError: unknown;

  for (const model of models) {
    const key = cacheKey(model, messages, options);
    const cached = ttlMs > 0 ? readCache(key) : undefined;
    if (cached) {
      log(`[llmClient] ${label}cache hit, model=${cached.model}`);
      return cached;
    }

    for (let attempt = 1; attempt <= attemptsPerModel; attempt += 1) {
      if (Date.now() >= deadline) {
        log(`[llmClient] ${label}budget exhausted before model=${model}`);
        throw lastError instanceof Error ? lastError : new Error("OpenRouter budget exhausted");
      }

      totalAttempts += 1;
      try {
        const result = await requestOnce(model, messages, options);
        const withAttempts = { ...result, attempts: totalAttempts };
        writeCache(key, withAttempts, ttlMs);
        log(`[llmClient] ${label}call succeeded, model=${result.model}, attempts=${totalAttempts}`);
        return withAttempts;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const httpError = err instanceof OpenRouterHttpError ? err : undefined;
        const aborted = err instanceof Error && err.name === "AbortError";
        const retryable = httpError ? httpError.retryable : aborted;

        if (!retryable || attempt === attemptsPerModel) {
          log(`[llmClient] ${label}model=${model} failed (${message}) — moving to next model`);
          break;
        }

        const backoff = Math.min(httpError?.retryAfterMs ?? 500 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
        log(`[llmClient] ${label}model=${model} attempt ${attempt} failed (${message}) — retrying in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All OpenRouter models failed");
}

/**
 * Extracts a JSON value from a completion. Free models honour JSON mode
 * inconsistently — they're prompted for bare JSON but still sometimes wrap it
 * in a ```json fence or add a stray sentence — so strip a fence if present,
 * then fall back to the first balanced `{...}`/`[...]` block in the text.
 */
export function parseJsonLoose<T>(text: string): T | null {
  const unfenced = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "");

  const candidates = [unfenced, unfenced.match(/\{[\s\S]*\}/)?.[0], unfenced.match(/\[[\s\S]*\]/)?.[0]].filter(
    (value): value is string => !!value
  );

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

/**
 * `callOpenRouter` for the common case: ask for a JSON object, get a parsed
 * one back or null. Sets `response_format` when a schema is supplied (models
 * that support structured output then can't drift), and parses leniently for
 * the ones that ignore it. Never throws.
 */
export async function callOpenRouterJson<T>(
  messages: ChatMessage[],
  options: CallOpenRouterOptions & { schema?: { name: string; schema: Record<string, unknown> } } = {}
): Promise<T | null> {
  const { schema, ...rest } = options;
  const responseFormat: ResponseFormat = schema
    ? { type: "json_schema", json_schema: { name: schema.name, strict: false, schema: schema.schema } }
    : { type: "json_object" };

  try {
    const { text } = await callOpenRouter(messages, { responseFormat, ...rest });
    const parsed = parseJsonLoose<T>(text);
    if (!parsed) {
      console.error(`[llmClient] ${options.label ?? "call"} response did not parse as JSON`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.error(`[llmClient] ${options.label ?? "call"} failed:`, err instanceof Error ? err.message : err);
    return null;
  }
}
