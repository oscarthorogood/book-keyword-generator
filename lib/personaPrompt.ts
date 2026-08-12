/**
 * Shared prompt/parsing machinery for the two persona keyword sources —
 * lib/llmPersonaSource.ts (OpenRouter) and lib/groqKeywordSource.ts (Groq).
 *
 * Both used to carry their own copy of a two-field prompt, and the OpenRouter
 * one hardcoded "You are a crime-fiction reader searching Amazon" as its
 * system message: a cookbook, a romantasy and a business title all got
 * crime-fiction queries generated from title + author alone. The persona is
 * now derived from the book's own genre vocabulary and the prompt carries the
 * metadata the pipeline already has (series, categories, tropes, comps,
 * description), so both providers ask the same, well-grounded question and
 * their outputs are comparable.
 *
 * Nothing here trusts the model: candidates come back tagged with their
 * source and run the full filter chain (lib/keywordFilters.ts) like every
 * other source.
 */

import { normalize } from "./keywordMerge";
import { manualCompetitors } from "./manualCompetitors";
import { IntentSegment, KeywordCandidate, KeywordSource, Marketplace } from "./types";

/** Query target. Free models under-deliver against a target, so ask high and cap after. */
export const REQUESTED_QUERIES = 40;
export const MAX_QUERIES = 60;
const MAX_DESCRIPTION_CHARS = 900;

export const INTENT_SEGMENTS: IntentSegment[] = [
  "alpha-core",
  "brand",
  "comp-author",
  "comp-title",
  "genre-core",
  "mood-setting",
  "discovery-longtail",
];

export interface PersonaBookContext {
  title?: string;
  author?: string;
  asin?: string;
  seriesName?: string;
  genreTerms?: string[];
  categories?: string[];
  description?: string;
  compTitles?: string[];
  compAuthors?: string[];
  keyTropes?: string[];
  marketplace?: Marketplace;
}

const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  US: "Amazon.com (US)",
  UK: "Amazon.co.uk (UK)",
  CA: "Amazon.ca (Canada)",
  DE: "Amazon.de (Germany)",
  FR: "Amazon.fr (France)",
  IT: "Amazon.it (Italy)",
  ES: "Amazon.es (Spain)",
};

/**
 * The reader the model plays, derived from the book's own genre vocabulary.
 * Falls back to a neutral book buyer rather than to any one genre — a wrong
 * persona is worse than a generic one, because every query it invents is then
 * confidently off-genre.
 */
export function describeReaderPersona(genreTerms: string[] = [], categories: string[] = []): string {
  const vocabulary = [...genreTerms, ...categories].map((term) => term.toLowerCase()).join(" ");

  const families: Array<{ match: RegExp; persona: string }> = [
    { match: /crime|detective|police|procedural|noir|murder/, persona: "a crime-fiction reader" },
    { match: /thriller|suspense|conspiracy/, persona: "a thriller reader" },
    { match: /myster|cozy|whodunit/, persona: "a mystery reader" },
    { match: /romance|romantasy|rom-com|romcom|love story/, persona: "a romance reader" },
    { match: /fantasy|epic|magic|dragon/, persona: "a fantasy reader" },
    { match: /science fiction|sci-fi|scifi|space opera|dystopian/, persona: "a science-fiction reader" },
    { match: /horror|ghost|haunt|supernatural/, persona: "a horror reader" },
    { match: /historical/, persona: "a historical-fiction reader" },
    { match: /young adult|teen|\bya\b/, persona: "a young-adult reader" },
    { match: /children|picture book|middle grade/, persona: "a parent buying children's books" },
    { match: /cookbook|recipe|cooking|baking/, persona: "a home cook browsing cookbooks" },
    { match: /business|marketing|entrepreneur|leadership|finance/, persona: "a professional buying business books" },
    { match: /self-help|self help|habit|productivity|mindfulness/, persona: "a reader looking for self-help books" },
    { match: /memoir|biograph/, persona: "a reader of memoirs and biography" },
    { match: /history|war|politic/, persona: "a non-fiction history reader" },
    { match: /health|fitness|diet|nutrition/, persona: "a reader buying health and fitness books" },
    { match: /religio|christian|spiritual|faith/, persona: "a reader buying religious and spiritual books" },
    { match: /textbook|study guide|exam|reference/, persona: "a student buying study material" },
  ];

  for (const { match, persona } of families) {
    if (match.test(vocabulary)) return persona;
  }

  const primary = genreTerms.find((term) => term.trim().length > 2);
  return primary ? `a reader who buys ${primary.toLowerCase()} books` : "a book buyer";
}

export function buildPersonaSystemPrompt(persona: string, marketplace?: Marketplace): string {
  const store = (marketplace && MARKETPLACE_LABELS[marketplace]) || MARKETPLACE_LABELS.US;
  return (
    `You are ${persona} searching ${store} for your next read. ` +
    `You type the way real shoppers type: lowercase, no punctuation, 2-6 words, ` +
    `sometimes an author or series name, sometimes a mood or trope, never marketing copy. ` +
    `Respond with JSON only.`
  );
}

export function buildPersonaContextLines(book: PersonaBookContext): string {
  const lines: Array<string | null> = [
    book.title ? `Title: ${book.title}` : null,
    book.author ? `Author: ${book.author}` : null,
    book.seriesName ? `Series: ${book.seriesName}` : null,
    book.genreTerms?.length ? `Genre/subject terms: ${book.genreTerms.slice(0, 12).join(", ")}` : null,
    book.categories?.length ? `Amazon categories: ${book.categories.slice(0, 6).join(" | ")}` : null,
    book.keyTropes?.length ? `Tropes/themes: ${book.keyTropes.slice(0, 12).join(", ")}` : null,
    book.compAuthors?.length ? `Comparable authors: ${book.compAuthors.slice(0, 8).join(", ")}` : null,
    book.compTitles?.length ? `Comparable titles: ${book.compTitles.slice(0, 8).join(", ")}` : null,
    book.description ? `Description: ${book.description.slice(0, MAX_DESCRIPTION_CHARS)}` : null,
  ];
  return lines.filter((line): line is string => !!line).join("\n");
}

export function buildPersonaUserPrompt(book: PersonaBookContext): string {
  return `Book you are trying to find something like:
${buildPersonaContextLines(book)}

Generate ${REQUESTED_QUERIES} distinct Amazon search queries a reader would actually type when they would end up buying a book like this one. Cover a spread of intents:
- "alpha-core": this exact book (title, title + author, series + book number)
- "brand": this author's name and their other work
- "comp-author": a comparable author's name
- "comp-title": a comparable book or series by name
- "genre-core": the plain genre/subgenre phrase people search
- "mood-setting": mood, tone, setting or period phrases
- "discovery-longtail": specific trope/premise phrases ("books about ...", "... with a twist ending")

Rules:
- Lowercase, no quotes, no punctuation, 2-6 words each.
- No invented author or book names — only names given above or ones you are certain exist.
- No queries about films, TV, games, merchandise or anything that isn't a book.
- No duplicates and no near-duplicates.

Return JSON exactly: {"queries":[{"q":"<query>","segment":"<one of the intents above>"}]}`;
}

export const PERSONA_RESPONSE_SCHEMA = {
  name: "persona_queries",
  schema: {
    type: "object",
    properties: {
      queries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            q: { type: "string" },
            segment: { type: "string", enum: INTENT_SEGMENTS },
          },
          required: ["q"],
        },
      },
    },
    required: ["queries"],
  },
} as { name: string; schema: Record<string, unknown> };

/** Best-effort heuristic classification, used when the model omits or invents a segment label. */
export function classifyIntentSegment(
  text: string,
  book: { title?: string; author?: string },
  compAuthors: string[] = [],
  compTitles: string[] = []
): IntentSegment {
  const normalized = normalize(text);
  if (book.title && normalized.includes(normalize(book.title))) return "alpha-core";
  if (book.author && normalized.includes(normalize(book.author))) return "brand";
  if (compAuthors.some((author) => author && normalized.includes(normalize(author)))) return "comp-author";
  if (compTitles.some((title) => title && normalized.includes(normalize(title)))) return "comp-title";
  const moodSettingWords = ["dark", "cozy", "gritty", "atmospheric", "small town", "coastal", "rural", "urban", "gothic"];
  if (moodSettingWords.some((word) => normalized.includes(word))) return "mood-setting";
  const genreWords = ["thriller", "mystery", "crime", "detective", "procedural", "noir", "suspense", "fantasy", "romance", "sci-fi"];
  if (genreWords.some((word) => normalized.includes(word))) return "genre-core";
  return "discovery-longtail";
}

export interface PersonaResponse {
  queries?: Array<{ q?: string; query?: string; segment?: string } | string>;
}

/**
 * Pulls query strings out of whatever the model returned: the JSON shape it
 * was asked for, a bare array of strings, or — when JSON mode was ignored
 * entirely — the raw completion parsed one query per line.
 */
export function extractPersonaQueries(
  parsed: PersonaResponse | null,
  rawFallback?: string
): Array<{ text: string; segment?: string }> {
  const entries = parsed?.queries;
  if (Array.isArray(entries)) {
    return entries
      .map((entry) => {
        if (typeof entry === "string") return { text: entry };
        const text = entry.q ?? entry.query;
        return typeof text === "string" ? { text, segment: entry.segment } : null;
      })
      .filter((entry): entry is { text: string; segment?: string } => !!entry);
  }

  if (!rawFallback) return [];
  return rawFallback
    .split("\n")
    .map((line) => line.replace(/^[\s\-*\d.)]+/, "").trim())
    .filter((line) => line.length >= 3 && line.length <= 100)
    .map((text) => ({ text }));
}

/** Comparable authors/titles the prompt may reference: the caller's crawled comps first, then the curated library. */
export function resolvePersonaComps(book: PersonaBookContext): { compAuthors: string[]; compTitles: string[] } {
  const curated = book.asin ? manualCompetitors[book.asin] : undefined;
  const compAuthors = Array.from(
    new Set([...(book.compAuthors ?? []), ...(curated?.authors ?? []).map((a) => a.name)].filter(Boolean))
  );
  const compTitles = Array.from(new Set([...(book.compTitles ?? []), ...(curated?.titles ?? [])].filter(Boolean)));
  return { compAuthors, compTitles };
}

/**
 * Normalizes, dedupes and caps the model's queries into candidates tagged
 * with `source`. Segment labels the model supplied are kept when they're part
 * of the taxonomy; anything else falls back to the heuristic classifier.
 */
export function personaQueriesToCandidates(
  queries: Array<{ text: string; segment?: string }>,
  source: KeywordSource,
  book: PersonaBookContext,
  compAuthors: string[],
  compTitles: string[]
): KeywordCandidate[] {
  const seen = new Set<string>();
  const candidates: KeywordCandidate[] = [];

  for (const { text, segment } of queries) {
    const normalized = normalize(text);
    if (normalized.length < 3 || normalized.length > 100) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const declared = INTENT_SEGMENTS.find((value) => value === segment);
    const wordCount = normalized.split(/\s+/).filter(Boolean).length;
    candidates.push({
      text: normalized,
      sources: [source],
      intentSegment: declared ?? classifyIntentSegment(normalized, book, compAuthors, compTitles),
      specificity: wordCount >= 3 ? 4 : 3,
    });

    if (candidates.length >= MAX_QUERIES) break;
  }

  return candidates;
}
