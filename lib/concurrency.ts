/**
 * Runs `fn` over `items` with at most `limit` in flight at once. Shared by
 * every call site that needs to bound parallel network/database requests —
 * enough concurrency to avoid paying full round-trip latency per item
 * serially, but not so much that a batch risks tripping a rate limit or
 * overwhelming a downstream service.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  // A limit of zero (or less) would spawn no workers at all: Promise.all([])
  // resolves at once and the caller gets an array of `undefined` the same
  // length as its input, with `fn` never called and no error raised anywhere.
  // Every caller currently clamps its own limit, so this is the guard for the
  // next one that doesn't — silently returning holes is the worst way for
  // that mistake to surface.
  const workers = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
