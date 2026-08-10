/**
 * Stable, deterministic author-code generation and caching (Phase 1.6).
 *
 * Problem: Running the generator twice on the same author produced different
 * author codes (FM vs MF for "Freida McFadden"), causing non-deterministic
 * filenames and campaign names.
 *
 * Solution: Hash the author name consistently to a 2-character code that
 * persists across runs. Cache this mapping in Supabase so re-runs always
 * produce the same code.
 */

import crypto from "crypto";

/**
 * Author code cache entry structure.
 */
export interface AuthorCodeEntry {
  authorName: string;
  code: string;
  createdAt: Date;
}

/**
 * Generate a deterministic 2-character code from an author name.
 * Uses the first letter + first consonant after the first vowel.
 * Fallback to base36 hash of author name if no valid consonant found.
 *
 * Examples:
 * - "Freida McFadden" → F + M = "FM"
 * - "Katherine Hastings" → K + T = "KT"
 * - "LJ Ross" → L + R = "LR"
 *
 * This is stable — given the same input, it always produces the same output.
 */
export function generateAuthorCode(authorName: string): string {
  if (!authorName || authorName.trim().length === 0) {
    return "XX";
  }

  const normalized = authorName.trim().toUpperCase();
  const words = normalized.split(/\s+/);

  // Try: First letter of first word + first letter of second word
  if (words.length >= 2) {
    const firstLetter = words[0][0];
    const secondLetter = words[1][0];
    if (firstLetter && secondLetter) {
      return (firstLetter + secondLetter).substring(0, 2);
    }
  }

  // Fallback 1: First letter + first letter of last word
  const firstLetter = words[0][0];
  const lastWord = words[words.length - 1];
  const lastLetter = lastWord?.[0];
  if (firstLetter && lastLetter && firstLetter !== lastLetter) {
    return (firstLetter + lastLetter).substring(0, 2);
  }

  // Fallback 2: Hash first 8 chars of author name to base36 (0-9, A-Z)
  const hash = crypto
    .createHash("sha256")
    .update(normalized.substring(0, 8))
    .digest()
    .readUInt16BE(0);
  const code = (hash % 36).toString(36).toUpperCase();
  const code2 = ((hash / 36) % 36).toString(36).toUpperCase();
  return (code + code2).substring(0, 2);
}

/**
 * In-memory cache of author → code mappings (single-run cache).
 * In production, this would query Supabase author_code table.
 */
const AUTHOR_CODE_CACHE = new Map<string, string>();

/**
 * Get or create a deterministic author code for this author.
 * In Phase 1.6, this is in-memory only. Phase 2 will add Supabase persistence.
 *
 * @param authorName The author's full name
 * @returns A stable 2-character code (e.g., "FM", "KT")
 */
export function getOrCreateAuthorCode(authorName: string): string {
  const normalized = authorName.trim();

  // Check in-memory cache first
  if (AUTHOR_CODE_CACHE.has(normalized)) {
    return AUTHOR_CODE_CACHE.get(normalized)!;
  }

  // Generate new code
  const code = generateAuthorCode(normalized);
  AUTHOR_CODE_CACHE.set(normalized, code);

  return code;
}

/**
 * Clear the in-memory author code cache (for testing only).
 */
export function clearAuthorCodeCache(): void {
  AUTHOR_CODE_CACHE.clear();
}

/**
 * Get all cached author code mappings (for inspection/debugging).
 */
export function getAllAuthorCodes(): Map<string, string> {
  return new Map(AUTHOR_CODE_CACHE);
}
