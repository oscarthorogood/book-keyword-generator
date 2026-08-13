/**
 * Paged reads for the aggregate endpoints.
 *
 * A `select()` with no `.range()` returns at most PostgREST's configured
 * `db-max-rows`, and it does so *silently* — no error, no flag, just a short
 * array. Every route that aggregates a whole table for a user (all-keywords,
 * the dashboard widgets, the source breakdown) was reading that way, so past
 * the cap its totals would quietly under-report rather than fail. Reading in
 * explicit pages makes the result correct regardless of how the server is
 * configured, and keeps peak memory to one page rather than one whole table.
 */

export interface PagedError {
  message: string;
}

/** Rows per round trip. Matches the common PostgREST `db-max-rows` default. */
export const SUPABASE_PAGE_SIZE = 1000;

/**
 * Absolute ceiling on rows pulled into memory for a single aggregate.
 * A serverless function has a fixed memory budget, so an account far larger
 * than anything expected should degrade to a logged, truncated answer rather
 * than an out-of-memory crash that takes the whole request down.
 */
export const SUPABASE_MAX_ROWS = 100_000;

/**
 * Runs `runPage` over successive ranges until a page comes back empty.
 *
 * `from` advances by the number of rows actually returned rather than by the
 * requested page size, so a server whose `db-max-rows` is smaller than
 * SUPABASE_PAGE_SIZE still walks the table correctly instead of stopping
 * after the first short page.
 *
 * IMPORTANT: the query built by `runPage` must carry a **deterministic total
 * order** — in practice `.order("id")` as the final key. Range paging is
 * LIMIT/OFFSET underneath, and Postgres guarantees nothing about row order
 * between two queries that don't fully order their output. Without a unique
 * tiebreaker the same row can land on two pages (or on none), which would
 * reintroduce, quietly, the miscounting this helper exists to prevent.
 * Ordering by a non-unique column alone is not enough: a generate run
 * inserts hundreds of rows sharing one `created_at`.
 *
 * Errors are returned, not thrown, matching the `{ data, error }` shape the
 * calling routes already branch on.
 */
export async function fetchAllRows<T>(
  runPage: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: PagedError | null }>,
  options: { label: string; pageSize?: number; maxRows?: number }
): Promise<{ data: T[]; error: PagedError | null }> {
  const pageSize = Math.max(1, options.pageSize ?? SUPABASE_PAGE_SIZE);
  const maxRows = options.maxRows ?? SUPABASE_MAX_ROWS;
  const all: T[] = [];

  let from = 0;
  while (from < maxRows) {
    const to = Math.min(from + pageSize, maxRows) - 1;

    const { data, error } = await runPage(from, to);
    if (error) {
      console.error(
        `[${options.label}] paged read failed at rows ${from}-${to}: ${error.message}`
      );
      return { data: all, error };
    }

    const page = data ?? [];
    // Appended in a loop rather than push(...page): spreading a large page
    // into the argument list can overflow the call stack.
    for (const row of page) all.push(row);

    if (page.length === 0) return { data: all, error: null };
    from += page.length;
  }

  console.error(
    `[${options.label}] reached the ${maxRows}-row ceiling; this aggregate is ` +
      "truncated and its totals are understated."
  );
  return { data: all, error: null };
}
