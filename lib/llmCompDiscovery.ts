/**
 * LLM comp-discovery (OpenRouter) — the query generator behind competitor-ASIN
 * discovery.
 *
 * Competitor generation is only as good as the search queries it runs. The
 * seeds it had were the book's top few genre terms, which return the same
 * handful of category bestsellers for every book in a genre. An LLM is
 * genuinely good at the missing step: naming the authors, series and
 * subgenre phrasings whose search results are full of *this* book's actual
 * shelf-mates.
 *
 * It is used strictly as a query generator, never as a source of truth: the
 * ASINs come back from Amazon (via SerpApi / ZenRows / Decodo in
 * lib/asinDiscovery.ts), and every candidate still goes through the same
 * metadata fetch, author de-duplication and bid scoring as any other. A
 * hallucinated author name costs one search that returns nothing relevant.
 *
 * Fails soft to an empty result whenever OPENROUTER_API_KEY is unset or the
 * call fails, so competitor generation is unchanged for users without a key.
 */

import { callOpenRouterJson, isOpenRouterConfigured } from "./llmClient";
import { PersonaBookContext, buildPersonaContextLines, describeReaderPersona, resolvePersonaComps } from "./personaPrompt";

const REQUESTED_QUERIES = 12;
export const MAX_COMP_QUERIES = 16;
const MAX_NAMES = 12;
const TEMPERATURE = 0.7;
const MAX_TOKENS = 1200;

export interface CompDiscoveryResult {
  /** Amazon search queries whose results should be full of competing books. */
  queries: string[];
  /** Comparable authors the model named — searched by name, and reusable as comp-name keyword seeds. */
  compAuthors: string[];
  /** Comparable titles/series the model named. */
  compTitles: string[];
}

const EMPTY: CompDiscoveryResult = { queries: [], compAuthors: [], compTitles: [] };

const RESPONSE_SCHEMA = {
  name: "comp_discovery",
  schema: {
    type: "object",
    properties: {
      queries: { type: "array", items: { type: "string" } },
      comp_authors: { type: "array", items: { type: "string" } },
      comp_titles: { type: "array", items: { type: "string" } },
    },
    required: ["queries"],
  },
} as { name: string; schema: Record<string, unknown> };

interface CompDiscoveryResponse {
  queries?: unknown;
  comp_authors?: unknown;
  compAuthors?: unknown;
  comp_titles?: unknown;
  compTitles?: unknown;
}

function cleanList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    const text = typeof entry === "string" ? entry : typeof entry === "object" && entry ? String((entry as Record<string, unknown>).q ?? (entry as Record<string, unknown>).name ?? "") : "";
    const cleaned = text.replace(/["']/g, "").replace(/\s+/g, " ").trim();
    if (cleaned.length < 3 || cleaned.length > 80) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (out.length >= limit) break;
  }
  return out;
}

function buildUserPrompt(book: PersonaBookContext): string {
  return `Book to find competitors for:
${buildPersonaContextLines(book)}

An Amazon search for this book's own title returns the book itself and nothing useful, and searching its broad genre returns the same category bestsellers for every book in it. Give search queries whose results pages would be full of books directly competing with this one for the same reader.

Produce:
1. "queries": ${REQUESTED_QUERIES} Amazon search queries. Mix comparable author names, comparable series names, and specific subgenre/trope phrasings ("small town police procedural", "slow burn enemies to lovers fantasy"). Lowercase, 2-6 words, no punctuation.
2. "comp_authors": authors whose readers would buy this book. Real, currently-published authors only.
3. "comp_titles": books or series that compete with this one. Real titles only.

Rules:
- Do not include this book's own title or author anywhere.
- Do not invent authors or titles. If you are not certain a name is real, leave it out.
- No films, TV, games or merchandise.

Return JSON exactly: {"queries":[...],"comp_authors":[...],"comp_titles":[...]}`;
}

/**
 * Asks OpenRouter for competitor-finding search queries and comparable
 * author/title names for the book. Returns empty lists (never throws) when
 * the key isn't configured or the call fails.
 */
export async function generateCompDiscoveryQueries(book: PersonaBookContext): Promise<CompDiscoveryResult> {
  if (!isOpenRouterConfigured()) return EMPTY;

  const { compAuthors, compTitles } = resolvePersonaComps(book);
  const persona = describeReaderPersona(book.genreTerms ?? [], book.categories ?? []);
  const promptBook: PersonaBookContext = { ...book, compAuthors, compTitles };

  const parsed = await callOpenRouterJson<CompDiscoveryResponse>(
    [
      {
        role: "system",
        content:
          `You are an Amazon book-advertising analyst who knows the ${persona.replace(/^an? /, "")}'s shelf inside out. ` +
          `You name only real, verifiable authors and titles. Respond with JSON only.`,
      },
      { role: "user", content: buildUserPrompt(promptBook) },
    ],
    {
      schema: RESPONSE_SCHEMA,
      temperature: TEMPERATURE,
      maxTokens: MAX_TOKENS,
      // ASIN discovery still has to run after this, inside the same 60s
      // route budget, so the query generator gets a tight ceiling.
      timeoutMs: 15_000,
      budgetMs: 20_000,
      label: "comp-discovery",
    }
  );

  if (!parsed) return EMPTY;

  const ownTitle = book.title?.toLowerCase().trim();
  const ownAuthor = book.author?.toLowerCase().trim();
  const isOwn = (value: string) => {
    const lower = value.toLowerCase();
    return (!!ownTitle && lower.includes(ownTitle)) || (!!ownAuthor && lower.includes(ownAuthor));
  };

  return {
    queries: cleanList(parsed.queries, MAX_COMP_QUERIES).filter((query) => !isOwn(query)),
    compAuthors: cleanList(parsed.comp_authors ?? parsed.compAuthors, MAX_NAMES).filter((name) => !isOwn(name)),
    compTitles: cleanList(parsed.comp_titles ?? parsed.compTitles, MAX_NAMES).filter((title) => !isOwn(title)),
  };
}
