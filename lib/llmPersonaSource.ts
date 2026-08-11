/**
 * Persona-LLM keyword source (spec §4) — asks an OpenRouter model to role-play
 * a genre reader searching Amazon, then parses its query list into
 * candidates. These are not trusted any more than a scraped source: they
 * still flow through the full filter chain (lib/keywordFilters.ts) in the
 * generate route like everything else, exactly the way every other optional
 * source is wired in (see app/api/books/[id]/keywords/generate/route.ts).
 */

import { callOpenRouter, isOpenRouterConfigured } from "./llmClient";
import { normalize } from "./keywordMerge";
import { manualCompetitors } from "./manualCompetitors";
import { IntentSegment, KeywordCandidate } from "./types";

const SYSTEM_PROMPT = "You are a crime-fiction reader searching Amazon.";

function buildUserPrompt(book: { title?: string; author?: string }, mentionedComps: string[]): string {
  const title = book.title ?? "this book";
  const author = book.author ?? "the author";
  const compClause = mentionedComps.length > 0 ? ` Feel free to reference titles/authors like ${mentionedComps.join(" or ")}.` : "";
  return (
    `Generate 30 Amazon search queries for finding books similar to ${title} by ${author}. ` +
    `Mix branded, genre, mood, and setting phrases. One query per line. No commentary.${compClause}`
  );
}

/** Best-effort heuristic classification of a persona-LLM query into an intent segment. */
function classifyIntentSegment(
  text: string,
  book: { title?: string; author?: string },
  compAuthors: string[],
  compTitles: string[]
): IntentSegment {
  const normalized = normalize(text);
  if (book.title && normalized.includes(normalize(book.title))) return "alpha-core";
  if (book.author && normalized.includes(normalize(book.author))) return "brand";
  if (compAuthors.some((author) => normalized.includes(normalize(author)))) return "comp-author";
  if (compTitles.some((title) => normalized.includes(normalize(title)))) return "comp-title";
  const moodSettingWords = ["dark", "cozy", "gritty", "atmospheric", "small town", "coastal", "rural", "urban", "gothic"];
  if (moodSettingWords.some((word) => normalized.includes(word))) return "mood-setting";
  const genreWords = ["thriller", "mystery", "crime", "detective", "procedural", "noir", "suspense"];
  if (genreWords.some((word) => normalized.includes(word))) return "genre-core";
  return "discovery-longtail";
}

function parseQueries(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 100);
}

/**
 * Calls OpenRouter to generate persona-driven search queries for the book,
 * parsing one query per line into candidates. Returns an empty array
 * gracefully (never throws) when OPENROUTER_API_KEY isn't configured or the
 * call fails, so generation for users without the key keeps working.
 */
export async function buildPersonaLlmCandidates(
  book: { title?: string; author?: string; asin?: string }
): Promise<KeywordCandidate[]> {
  if (!isOpenRouterConfigured()) return [];

  const entry = book.asin ? manualCompetitors[book.asin] : undefined;
  const compAuthors = (entry?.authors ?? []).map((a) => a.name);
  const compTitles = entry?.titles ?? [];
  const mentionedComps = [...compAuthors.slice(0, 1), ...compTitles.slice(0, 1)];

  try {
    const { text } = await callOpenRouter([
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(book, mentionedComps) },
    ]);

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
        sources: ["persona-llm"],
        intentSegment: classifyIntentSegment(normalized, book, compAuthors, compTitles),
        specificity: wordCount >= 3 ? 4 : 3,
      });
    }
    return candidates;
  } catch (err) {
    console.error("[llmPersonaSource] persona-llm generation failed:", err instanceof Error ? err.message : err);
    return [];
  }
}
