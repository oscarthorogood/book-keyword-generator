/**
 * Critics/listicles keyword source (spec §6) — mines short blurb strings
 * (pull quotes, listicle snippets) for descriptor phrases and comp
 * relationships. Deliberately modest: a keyword/phrase-list extractor in the
 * same style as the COMPARABLE_MENTION_PATTERNS regexes in
 * lib/keywordMerge.ts, not a new NLP dependency.
 */

import { normalize } from "./keywordMerge";
import { KeywordCandidate } from "./types";

/** Descriptor adjectives worth pulling out of critic blurbs as mood/setting keywords. */
const DESCRIPTOR_TERMS = [
  "gripping", "unputdownable", "chilling", "atmospheric", "twisty", "gritty",
  "compelling", "haunting", "propulsive", "taut", "menacing", "dark",
  "fast paced", "page turning", "page turner", "addictive", "explosive",
  "nail biting", "spine chilling", "edge of your seat",
];

/** Patterns critics/listicles use to name a comp author or title. */
const COMP_MENTION_PATTERNS = [
  /for fans of ([^.,;\n]+)/gi,
  /perfect for fans of ([^.,;\n]+)/gi,
  /reminiscent of ([^.,;\n]+)/gi,
  /in the tradition of ([^.,;\n]+)/gi,
  /rivals? ([^.,;\n]+)/gi,
  /the next ([^.,;\n]+)/gi,
];

function extractDescriptors(text: string): string[] {
  const lower = text.toLowerCase();
  return DESCRIPTOR_TERMS.filter((term) => lower.includes(term));
}

function extractCompMentions(text: string): string[] {
  const names = new Set<string>();
  for (const pattern of COMP_MENTION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const parts = match[1].split(/,| and | & /i);
      for (const part of parts) {
        const normalized = normalize(part);
        if (normalized.length >= 3 && normalized.length <= 60) names.add(normalized);
      }
    }
  }
  return Array.from(names);
}

/**
 * Builds mood/setting and comp keywords from a set of short critic
 * blurb/listicle strings.
 */
export function buildCriticsBlurbsCandidates(
  book: { genre?: string },
  blurbs: string[]
): KeywordCandidate[] {
  const genre = book.genre?.trim();
  const out: KeywordCandidate[] = [];
  const seenMood = new Set<string>();
  const seenComp = new Set<string>();

  for (const blurb of blurbs) {
    for (const descriptor of extractDescriptors(blurb)) {
      const text = normalize(genre ? `${descriptor} ${genre}` : descriptor);
      if (seenMood.has(text)) continue;
      seenMood.add(text);
      const wordCount = text.split(/\s+/).filter(Boolean).length;
      out.push({
        text,
        sources: ["critics-blurbs"],
        category: "mood-tone",
        intentSegment: "mood-setting",
        specificity: wordCount >= 3 ? 4 : 3,
      });
    }

    for (const comp of extractCompMentions(blurb)) {
      if (seenComp.has(comp)) continue;
      seenComp.add(comp);
      out.push({
        text: comp,
        sources: ["critics-blurbs"],
        category: "comp-titles",
        intentSegment: "comp-title",
        matchType: "phrase",
        specificity: 4,
      });
    }
  }

  return out;
}
