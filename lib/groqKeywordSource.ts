/**
 * Groq-powered persona keyword source — mirrors lib/llmPersonaSource.ts but
 * uses Groq's inference API (api.groq.com) instead of OpenRouter, sharing the
 * same genre-derived persona and prompt (lib/personaPrompt.ts) so the two
 * providers' outputs are directly comparable.
 *
 * Groq runs LLaMA 3 and Gemma models with very low latency, making it a good
 * complement to OpenRouter: where OpenRouter's free tier can be slow or
 * saturated, Groq consistently returns in under 2 s. The generated queries go
 * through the same full filter chain (lib/keywordFilters.ts) as everything
 * else, so noisy/hallucinated results are caught before they reach the DB.
 *
 * Activate by setting GROQ_API_KEY in your environment:
 *   https://console.groq.com
 */

import { callGroq, isGroqConfigured } from "./groqClient";
import { parseJsonLoose } from "./llmClient";
import {
  PersonaBookContext,
  PersonaResponse,
  buildPersonaSystemPrompt,
  buildPersonaUserPrompt,
  describeReaderPersona,
  extractPersonaQueries,
  personaQueriesToCandidates,
  resolvePersonaComps,
} from "./personaPrompt";
import { KeywordCandidate } from "./types";

const PERSONA_TEMPERATURE = 0.85;
const PERSONA_MAX_TOKENS = 2000;

/**
 * Calls Groq to generate persona-driven search queries for the book, parsing
 * them into KeywordCandidates tagged with source "groq-persona". Returns []
 * gracefully when GROQ_API_KEY isn't configured or the call fails, so
 * generation for users without the key keeps working.
 */
export async function buildGroqPersonaCandidates(book: PersonaBookContext): Promise<KeywordCandidate[]> {
  if (!isGroqConfigured()) return [];

  const { compAuthors, compTitles } = resolvePersonaComps(book);
  const genreTerms = book.genreTerms ?? [];
  const persona = describeReaderPersona(genreTerms, book.categories ?? []);
  const promptBook: PersonaBookContext = { ...book, compAuthors, compTitles, genreTerms };

  try {
    const { text } = await callGroq(
      [
        { role: "system", content: buildPersonaSystemPrompt(persona, book.marketplace) },
        { role: "user", content: buildPersonaUserPrompt(promptBook) },
      ],
      { temperature: PERSONA_TEMPERATURE, maxTokens: PERSONA_MAX_TOKENS, responseFormat: { type: "json_object" } }
    );

    // Groq honours JSON mode, but the line-per-query fallback keeps this
    // working if a model in the chain ignores it.
    const parsed = parseJsonLoose<PersonaResponse>(text);
    const queries = extractPersonaQueries(parsed, text);
    return personaQueriesToCandidates(queries, "groq-persona", book, compAuthors, compTitles);
  } catch (err) {
    console.error("[groqKeywordSource] generation failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
