/**
 * Persona-LLM keyword source (OpenRouter) — asks a model to role-play a
 * reader of *this book's* genre searching Amazon, then turns its query list
 * into candidates. These are not trusted any more than a scraped source: they
 * still flow through the full filter chain (lib/keywordFilters.ts) in the
 * generate route like everything else, exactly the way every other optional
 * source is wired in (see app/api/books/[id]/keywords/generate/route.ts).
 *
 * The persona and the prompt come from lib/personaPrompt.ts, shared with the
 * Groq persona source so both providers ask the same grounded question.
 */

import { callOpenRouter, isOpenRouterConfigured, parseJsonLoose } from "./llmClient";
import {
  PERSONA_RESPONSE_SCHEMA,
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

export type { PersonaBookContext } from "./personaPrompt";

/**
 * Calls OpenRouter to generate persona-driven search queries for the book.
 * Returns an empty array gracefully (never throws) when OPENROUTER_API_KEY
 * isn't configured or the call fails, so generation for users without the key
 * keeps working.
 */
export async function buildPersonaLlmCandidates(book: PersonaBookContext): Promise<KeywordCandidate[]> {
  if (!isOpenRouterConfigured()) return [];

  const { compAuthors, compTitles } = resolvePersonaComps(book);
  const genreTerms = book.genreTerms ?? [];
  const persona = describeReaderPersona(genreTerms, book.categories ?? []);
  const promptBook: PersonaBookContext = { ...book, compAuthors, compTitles, genreTerms };

  try {
    const { text } = await callOpenRouter(
      [
        { role: "system", content: buildPersonaSystemPrompt(persona, book.marketplace) },
        { role: "user", content: buildPersonaUserPrompt(promptBook) },
      ],
      {
        responseFormat: {
          type: "json_schema",
          json_schema: { name: PERSONA_RESPONSE_SCHEMA.name, strict: false, schema: PERSONA_RESPONSE_SCHEMA.schema },
        },
        temperature: PERSONA_TEMPERATURE,
        maxTokens: PERSONA_MAX_TOKENS,
        // Bounded so a slow chain can't eat the generate route's 60s budget —
        // this source runs alongside every other live fetch.
        timeoutMs: 20_000,
        budgetMs: 25_000,
        label: "persona-llm",
      }
    );

    // Free models honour JSON mode inconsistently — the line-per-query
    // fallback keeps a plain list usable rather than discarding the call.
    const queries = extractPersonaQueries(parseJsonLoose<PersonaResponse>(text), text);
    return personaQueriesToCandidates(queries, "persona-llm", book, compAuthors, compTitles);
  } catch (err) {
    console.error("[llmPersonaSource] persona-llm generation failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
