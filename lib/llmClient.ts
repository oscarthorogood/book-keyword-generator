/**
 * Thin OpenRouter chat-completion client (spec §4). Fetch-based like every
 * other external call in this app (see lib/firecrawl.ts) — no SDK
 * dependency for a handful of calls.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const LLM_TIMEOUT_MS = 25000;

export function isOpenRouterConfigured(): boolean {
  return !!OPENROUTER_API_KEY;
}

export const DEFAULT_OPENROUTER_MODEL = "openrouter/free";

/** Tried in order if the default model's request fails. */
export const OPENROUTER_FALLBACK_MODELS = [
  "deepseek/deepseek-chat-v3-0324:free",
  "meta-llama/llama-3.3-70b-instruct:free",
];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallOpenRouterOptions {
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  maxTokens?: number;
  logger?: (message: string) => void;
}

export interface CallOpenRouterResult {
  text: string;
  model: string;
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

async function requestOnce(model: string, messages: ChatMessage[], options: CallOpenRouterOptions): Promise<CallOpenRouterResult> {
  const res = await fetchWithTimeout(
    OPENROUTER_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 800,
      }),
    },
    LLM_TIMEOUT_MS
  );

  if (!res.ok) {
    throw new Error(`OpenRouter request failed for model ${model}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  const returnedModel = data.model ?? model;
  return { text, model: returnedModel };
}

/**
 * Calls OpenRouter's chat-completion endpoint, trying the default model
 * first and falling through OPENROUTER_FALLBACK_MODELS on failure. Logs the
 * actual `model` field OpenRouter returns for each successful call. Throws
 * only if every model in the chain fails — callers that must not throw
 * (e.g. buildPersonaLlmCandidates) should catch and fail soft themselves.
 */
export async function callOpenRouter(
  messages: ChatMessage[],
  options: CallOpenRouterOptions = {}
): Promise<CallOpenRouterResult> {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const log = options.logger ?? ((message: string) => console.warn(message));
  const models = [options.model ?? DEFAULT_OPENROUTER_MODEL, ...(options.fallbackModels ?? OPENROUTER_FALLBACK_MODELS)];

  let lastError: unknown;
  for (const model of models) {
    try {
      const result = await requestOnce(model, messages, options);
      log(`[llmClient] OpenRouter call succeeded, model=${result.model}`);
      return result;
    } catch (err) {
      lastError = err;
      log(`[llmClient] OpenRouter call failed for model=${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All OpenRouter models failed");
}
