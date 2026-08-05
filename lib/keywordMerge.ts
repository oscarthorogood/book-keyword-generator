import { BookMetadata, KeywordCandidate, ProductPageData } from "./types";

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isUsableKeyword(text: string): boolean {
  if (text.length < 3 || text.length > 80) return false;
  // Drop noisy Open Library / Google Books subjects (URLs, ID-like tags, etc.)
  if (/https?:\/\//.test(text)) return false;
  if (/^\d+$/.test(text)) return false;
  return true;
}

/**
 * Splits combined category strings like "Fiction / Fantasy / Epic" or
 * "Fiction, Fantasy, Epic" into individual thematic keyword candidates.
 */
function splitCategoryString(raw: string): string[] {
  return raw
    .split(/\/|,|>/)
    .map((s) => normalize(s))
    .filter(isUsableKeyword);
}

export function buildGenreMetadataCandidates(metadata: BookMetadata): KeywordCandidate[] {
  const texts = new Set<string>();

  for (const category of metadata.categories) {
    for (const piece of splitCategoryString(category)) texts.add(piece);
  }
  for (const subject of metadata.subjects) {
    const normalized = normalize(subject);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }

  return Array.from(texts).map((text) => ({ text, sources: ["genre-metadata"] }));
}

export function buildCompTitleCandidates(productPage: ProductPageData): KeywordCandidate[] {
  const texts = new Set<string>();

  for (const title of productPage.compTitles) {
    const normalized = normalize(title);
    if (isUsableKeyword(normalized)) texts.add(normalized);
  }
  for (const category of productPage.categories) {
    for (const piece of splitCategoryString(category)) texts.add(piece);
  }

  return Array.from(texts).map((text) => ({ text, sources: ["comp-title"] }));
}

/**
 * Merges keyword candidates from every source into one deduped list, tagged
 * with all sources that surfaced each term, keeping the first bid estimate
 * found (only the Ads API source currently supplies one).
 */
export function mergeKeywordCandidates(...groups: KeywordCandidate[][]): KeywordCandidate[] {
  const merged = new Map<string, KeywordCandidate>();

  for (const group of groups) {
    for (const candidate of group) {
      const text = normalize(candidate.text);
      if (!isUsableKeyword(text)) continue;

      const existing = merged.get(text);
      if (existing) {
        const sources = new Set([...existing.sources, ...candidate.sources]);
        existing.sources = Array.from(sources);
        existing.suggestedBid = existing.suggestedBid ?? candidate.suggestedBid;
      } else {
        merged.set(text, { ...candidate, text });
      }
    }
  }

  return Array.from(merged.values());
}
