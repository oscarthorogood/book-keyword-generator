/**
 * Filter allowlist overrides (Enhancements spec §16, scoped): once a
 * rejected keyword is restored to the allowlist, the pipeline's next
 * generate run must not reject that exact text again — checked after the
 * filter pipeline runs, rather than inside it, so lib/keywordFilters.ts
 * stays the same synchronous, DB-free module its existing tests assert
 * against.
 */

function normalize(text: string): string {
  return text.toLowerCase().trim();
}

export interface AllowlistableRow {
  text: string;
  status: string;
}

/**
 * Which of these rows are rejected/paused but on the allowlist, and should
 * be promoted to active instead.
 */
export function findAllowlistOverrides<T extends AllowlistableRow>(
  rows: T[],
  allowlistedTexts: Iterable<string>
): T[] {
  const allowlist = new Set(Array.from(allowlistedTexts, normalize));
  if (allowlist.size === 0) return [];
  return rows.filter((row) => row.status !== "active" && allowlist.has(normalize(row.text)));
}
