/**
 * Thin Groq chat-completion client. Groq's API is OpenAI-compatible,
 * so the request/response shape is identical to OpenRouter — only the
 * base URL, auth header, and available models differ.
 *
 * Configure by setting GROQ_API_KEY in your environment.
 * Available models: https://console.groq.com/docs/models
 * Recommended free-tier models: llama-3.3-70b-versatile, llama3-8b-8192
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TIMEOUT_MS = 20000;

export const DEFAULT_GROQ_MODEL = "llama-3.3-70b-versatile";

/** Tried in order if the primary model's request fails. */
export const GROQ_FALLBACK_MODELS = ["llama3-8b-8192", "gemma2-9b-it"];

export function isGroqConfigured(): boolean {
  return !!GROQ_API_KEY;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CallGroqOptions {
  model?: string;
  fallbackModels?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface CallGroqResult {
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

async function requestOnce(
  model: string,
  messages: ChatMessage[],
  options: CallGroqOptions
): Promise<CallGroqResult> {
  const res = await fetchWithTimeout(
    GROQ_URL,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 800,
      }),
    },
    GROQ_TIMEOUT_MS
  );

  if (!res.ok) {
    throw new Error(`Groq request failed for model ${model}: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    model?: string;
    choices?: Array<{ message?: { content?: string } }>;
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  return { text, model: data.model ?? model };
}

/**
 * Calls Groq's chat-completion endpoint, trying DEFAULT_GROQ_MODEL first
 * and falling through GROQ_FALLBACK_MODELS on failure. Throws only if every
 * model in the chain fails — callers should catch and fail soft.
 */
export async function callGroq(
  messages: ChatMessage[],
  options: CallGroqOptions = {}
): Promise<CallGroqResult> {
  if (!GROQ_API_KEY) {
    throw new Error("GROQ_API_KEY is not configured");
  }

  const models = [
    options.model ?? DEFAULT_GROQ_MODEL,
    ...(options.fallbackModels ?? GROQ_FALLBACK_MODELS),
  ];

  let lastError: unknown;
  for (const model of models) {
    try {
      const result = await requestOnce(model, messages, options);
      console.warn(`[groqClient] call succeeded, model=${result.model}`);
      return result;
    } catch (err) {
      lastError = err;
      console.warn(`[groqClient] call failed for model=${model}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All Groq models failed");
}
