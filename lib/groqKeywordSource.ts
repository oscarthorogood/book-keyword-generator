/**
 * Groq-powered persona keyword source — mirrors lib/llmPersonaSource.ts but
 * uses Groq's inference API (api.groq.com) instead of OpenRouter.
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
import { normalize } from "./keywordMerge";
import { manualCompetitors } from "./manualCompetitors";
import { IntentSegment, KeywordCandidate } from "./types";

function buildUserPrompt(book: { title?: string; author?: string }, mentionedComps: string[]): string {
  const title = book.title ?? "this book";
  const author = book.author ?? "the author";
  const compClause =
    mentionedComps.length > 0
      ? ` Feel free to reference titles/authors like ${mentionedComps.join(" or ")}.`
      : "";
  return (
    `Generate 30 Amazon search queries for finding books similar to "${title}" by ${author}. ` +
    `Mix branded queries (author/title name), genre phrases, mood/tone phrases, and setting phrases. ` +
    `One query per line, no commentary, no numbering, no bullet points.${compClause}`
  );
}

/** Best-effort heuristic classification — identical logic to llmPersonaSource. */
function classifyIntentSegment(
  text: string,
  book: { title?: string; author?: string },
  compAuthors: string[],
  compTitles: string[]
): IntentSegment {
  const normalized = normalize(text);
  if (book.title && normalized.includes(normalize(book.title))) return "alpha-core";
  if (book.author && normalized.includes(normalize(book.author))) return "brand";
  if (compAuthors.some((a) => normalized.includes(normalize(a)))) return "comp-author";
  if (compTitles.some((t) => normalized.includes(normalize(t)))) return "comp-title";
  const moodWords = ["dark", "cozy", "gritty", "atmospheric", "small town", "coastal", "rural", "urban", "gothic"];
  if (moodWords.some((w) => normalized.includes(w))) return "mood-setting";
  const genreWords = ["thriller", "mystery", "crime", "detective", "procedural", "noir", "suspense", "fantasy", "romance", "sci-fi"];
  if (genreWords.some((w) => normalized.includes(w))) return "genre-core";
  return "discovery-longtail";
}

function parseQueries(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 100);
}

/**
 * Calls Groq to generate persona-driven search queries for the book,
 * parsing one query per line into KeywordCandidates tagged with source
 * "groq-persona". Returns [] gracefully when GROQ_API_KEY isn't configured
 * or the call fails, so generation for users without the key keeps working.
 */
export async function buildGroqPersonaCandidates(
  book: { title?: string; author?: string; asin?: string }
): Promise<KeywordCandidate[]> {
  if (!isGroqConfigured()) return [];

  const entry = book.asin ? manualCompetitors[book.asin] : undefined;
  const compAuthors = (entry?.authors ?? []).map((a) => a.name);
  const compTitles = entry?.titles ?? [];
  const mentionedComps = [...compAuthors.slice(0, 1), ...compTitles.slice(0, 1)];

  try {
    const { text } = await callGroq(
      [
        {
          role: "system",
          content:
            "You are an avid reader helping optimise Amazon book advertising. Generate realistic Amazon search queries that a reader would type.",
        },
        { role: "user", content: buildUserPrompt(book, mentionedComps) },
      ],
      { temperature: 0.85, maxTokens: 900 }
    );

    const queries = parseQueries(text);
    const seen = new Set<string>();
    const candidates: KeywordCandidate[] = [];

    for (const query of queries) {
      const normalized = normalize(query);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      const wordCount = normalized.split(/\s+/).filter(Boolean).length;
      candidates.push({
        text: normalized,
        sources: ["groq-persona" as any],
        intentSegment: classifyIntentSegment(normalized, book, compAuthors, compTitles),
        specificity: wordCount >= 3 ? 4 : 3,
      });
    }

    return candidates;
  } catch (err) {
    console.error("[groqKeywordSource] generation failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
