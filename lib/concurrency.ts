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

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
