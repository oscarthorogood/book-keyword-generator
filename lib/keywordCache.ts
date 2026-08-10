/**
 * Keyword generation caching and determinism (Phase 1.6).
 *
 * Problem: Running the generator twice on the same ASIN produced different
 * keyword sets (~96% overlap, 3 different bids, different comp ASINs).
 *
 * Solution: Hash the generation input parameters to a fingerprint. Cache
 * the validated keyword set per ASIN + fingerprint. On re-runs with the
 * same inputs, return the cached keywords. On different inputs, compute fresh
 * and optionally detect the diff.
 */

import crypto from "crypto";
import { KeywordCandidate, GenerateRequest } from "./types";

/**
 * Metadata about a cached keyword generation result.
 */
export interface KeywordCacheEntry {
  asin: string;
  marketplace: string;
  generationFingerprint: string;
  keywords: KeywordCandidate[];
  cachedAt: Date;
  expiresAt?: Date;
}

/**
 * Result of a keyword-cache lookup or generation.
 */
export interface KeywordCacheResult {
  isCached: boolean;
  keywords: KeywordCandidate[];
  fingerprint: string;
  cacheInfo?: {
    cachedAt: Date;
    age: number; // milliseconds
  };
}

/**
 * Diff summary when comparing two keyword sets.
 */
export interface KeywordDiff {
  similarity: number; // 0-1 (1 = identical)
  added: KeywordCandidate[];
  removed: KeywordCandidate[];
  modified: Array<{
    text: string;
    oldBid?: number;
    newBid?: number;
  }>;
}

/**
 * Generate a fingerprint of the generation request parameters.
 * This deterministically identifies a generation run by its inputs.
 *
 * Includes:
 * - ASIN, marketplace
 * - Book metadata (title, author, series)
 * - Campaign settings (budget, dates)
 * - Bid economics (RRP, ACOS, default bid)
 * - Keyword preferences (sources, match types, categories)
 * - Manual inputs (keywords, tropes)
 *
 * Does NOT include:
 * - Timestamps or random IDs
 * - Order of keyword sources (set comparison)
 * - UI/display preferences
 */
export function generateRequestFingerprint(req: GenerateRequest): string {
  const sortedSources = [...(req.sources ?? [])].sort();
  const sortedMatchTypes = [...(req.matchTypes ?? [])].sort();
  const sortedCategories = [...(req.keywordCategories ?? [])].sort();
  const sortedTropes = [...(req.keyTropes ?? [])].sort();
  const sortedManualKeywords = [...(req.manualKeywords ?? [])].sort();

  const fingerprintData = {
    asin: req.asin,
    marketplace: req.marketplace,
    authorName: req.authorName,
    bookTitle: req.bookTitle,
    seriesName: req.seriesName ?? null,
    seriesOrder: req.seriesOrder ?? null,
    seriesTotal: req.seriesTotal ?? null,
    dailyBudget: req.dailyBudget,
    startDate: req.startDate,
    endDate: req.endDate ?? null,
    bidEconomics: req.bidEconomics ?? null,
    defaultBid: req.defaultBid ?? null,
    sources: sortedSources,
    matchTypes: sortedMatchTypes,
    keywordCategories: sortedCategories,
    keywordTypes: req.keywordTypes ?? [],
    keyTropes: sortedTropes,
    manualKeywords: sortedManualKeywords,
  };

  const jsonString = JSON.stringify(fingerprintData, null, 0);
  return crypto.createHash("sha256").update(jsonString).digest("hex");
}

/**
 * In-memory keyword cache (single-run cache).
 * In production, this would be Supabase keyword_cache table.
 *
 * Key: `${asin}:${fingerprint}`
 * Value: Cached KeywordCacheEntry
 */
const KEYWORD_CACHE = new Map<string, KeywordCacheEntry>();

/**
 * Store keywords in the cache.
 */
export function cacheKeywords(
  entry: KeywordCacheEntry,
  ttlMs: number = 24 * 60 * 60 * 1000
): void {
  const key = `${entry.asin}:${entry.generationFingerprint}`;
  entry.expiresAt = new Date(Date.now() + ttlMs);
  KEYWORD_CACHE.set(key, entry);
}

/**
 * Retrieve keywords from the cache if they exist and haven't expired.
 */
export function lookupKeywordCache(
  asin: string,
  fingerprint: string
): KeywordCacheEntry | null {
  const key = `${asin}:${fingerprint}`;
  const entry = KEYWORD_CACHE.get(key);

  if (!entry) return null;

  // Check expiration
  if (entry.expiresAt && new Date() > entry.expiresAt) {
    KEYWORD_CACHE.delete(key);
    return null;
  }

  return entry;
}

/**
 * Calculate similarity between two keyword sets (0-1).
 * Uses Jaccard similarity: |intersection| / |union|
 */
export function calculateKeywordSimilarity(
  set1: KeywordCandidate[],
  set2: KeywordCandidate[]
): number {
  if (set1.length === 0 && set2.length === 0) return 1;
  if (set1.length === 0 || set2.length === 0) return 0;

  const texts1 = new Set(set1.map((k) => k.text.toLowerCase()));
  const texts2 = new Set(set2.map((k) => k.text.toLowerCase()));

  const intersection = [...texts1].filter((t) => texts2.has(t)).length;
  const union = new Set([...texts1, ...texts2]).size;

  return intersection / union;
}

/**
 * Compare two keyword sets and detect differences.
 * Used when a re-run has a different fingerprint (inputs changed).
 */
export function diffKeywordSets(
  oldKeywords: KeywordCandidate[],
  newKeywords: KeywordCandidate[]
): KeywordDiff {
  const oldMap = new Map(oldKeywords.map((k) => [k.text.toLowerCase(), k]));
  const newMap = new Map(newKeywords.map((k) => [k.text.toLowerCase(), k]));

  const added: KeywordCandidate[] = [];
  const removed: KeywordCandidate[] = [];
  const modified: Array<{ text: string; oldBid?: number; newBid?: number }> =
    [];

  // Find added and modified
  for (const [text, newKw] of newMap) {
    const oldKw = oldMap.get(text);
    if (!oldKw) {
      added.push(newKw);
    } else if (oldKw.suggestedBid !== newKw.suggestedBid) {
      modified.push({
        text,
        oldBid: oldKw.suggestedBid,
        newBid: newKw.suggestedBid,
      });
    }
  }

  // Find removed
  for (const [text, oldKw] of oldMap) {
    if (!newMap.has(text)) {
      removed.push(oldKw);
    }
  }

  const similarity = calculateKeywordSimilarity(oldKeywords, newKeywords);

  return {
    similarity,
    added,
    removed,
    modified,
  };
}

/**
 * Clear the in-memory keyword cache (for testing).
 */
export function clearKeywordCache(): void {
  KEYWORD_CACHE.clear();
}

/**
 * Get cache statistics (for inspection/debugging).
 */
export function getKeywordCacheStats(): {
  totalEntries: number;
  totalKeywords: number;
} {
  let totalKeywords = 0;
  for (const entry of KEYWORD_CACHE.values()) {
    totalKeywords += entry.keywords.length;
  }
  return {
    totalEntries: KEYWORD_CACHE.size,
    totalKeywords,
  };
}
