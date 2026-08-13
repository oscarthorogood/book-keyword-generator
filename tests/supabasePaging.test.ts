/**
 * lib/supabasePaging.ts — the paged reader behind the aggregate endpoints.
 * Pure logic over an injected page-fetcher, so no Supabase client is needed:
 * each test supplies its own fake pager and asserts on the ranges requested.
 */

import { describe, expect, it, vi } from "vitest";
import { fetchAllRows, SUPABASE_PAGE_SIZE } from "../lib/supabasePaging";

/** A pager over `total` synthetic rows that never returns more than `serverCap` at once. */
function pagerOver(total: number, serverCap = Number.POSITIVE_INFINITY) {
  const ranges: Array<[number, number]> = [];
  const runPage = async (from: number, to: number) => {
    ranges.push([from, to]);
    const requested = to - from + 1;
    const end = Math.min(from + Math.min(requested, serverCap), total);
    const data = end > from ? Array.from({ length: end - from }, (_, i) => ({ id: from + i })) : [];
    return { data, error: null };
  };
  return { runPage, ranges };
}

describe("fetchAllRows", () => {
  it("returns every row across multiple pages", async () => {
    const { runPage } = pagerOver(2500);

    const { data, error } = await fetchAllRows(runPage, { label: "test", pageSize: 1000 });

    expect(error).toBeNull();
    expect(data).toHaveLength(2500);
    // Contiguous and in order — no rows dropped or duplicated at page seams.
    expect(data[0]).toEqual({ id: 0 });
    expect(data[2499]).toEqual({ id: 2499 });
  });

  it("requests contiguous, non-overlapping ranges", async () => {
    const { runPage, ranges } = pagerOver(2500);

    await fetchAllRows(runPage, { label: "test", pageSize: 1000 });

    expect(ranges.slice(0, 3)).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("keeps paging when the server caps pages below the requested size", async () => {
    // The regression this guards: advancing by the requested page size rather
    // than by the rows actually returned would stop here after 500 of 1200.
    const { runPage } = pagerOver(1200, 500);

    const { data } = await fetchAllRows(runPage, { label: "test", pageSize: 1000 });

    expect(data).toHaveLength(1200);
  });

  it("stops on the first empty page rather than looping to the ceiling", async () => {
    const { runPage, ranges } = pagerOver(0);

    const { data } = await fetchAllRows(runPage, { label: "test", pageSize: 1000 });

    expect(data).toEqual([]);
    expect(ranges).toHaveLength(1);
  });

  it("returns the error and the rows read so far", async () => {
    const failing = async (from: number) =>
      from === 0
        ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: "connection reset" } };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { data, error } = await fetchAllRows(failing, { label: "test", pageSize: 1000 });

    expect(error).toEqual({ message: "connection reset" });
    expect(data).toHaveLength(1000);
    consoleError.mockRestore();
  });

  it("stops at maxRows and logs that the aggregate is truncated", async () => {
    const { runPage } = pagerOver(10_000);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const { data } = await fetchAllRows(runPage, {
      label: "test",
      pageSize: 1000,
      maxRows: 2000,
    });

    expect(data).toHaveLength(2000);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("truncated"));
    consoleError.mockRestore();
  });

  it("never requests rows beyond maxRows", async () => {
    const { runPage, ranges } = pagerOver(10_000);

    await fetchAllRows(runPage, { label: "test", pageSize: 1000, maxRows: 1500 });

    expect(ranges.every(([, to]) => to <= 1499)).toBe(true);
  });

  it("defaults to the standard page size", async () => {
    const { runPage, ranges } = pagerOver(10);

    await fetchAllRows(runPage, { label: "test" });

    expect(ranges[0]).toEqual([0, SUPABASE_PAGE_SIZE - 1]);
  });
});
