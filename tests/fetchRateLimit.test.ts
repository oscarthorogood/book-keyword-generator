/**
 * lib/fetchLog.ts — the per-host concurrency cap and request spacing.
 *
 * Uses fake timers so the real 1200ms Amazon gap doesn't make the suite slow:
 * the limiter's waits go through setTimeout, and Date.now() is faked in step
 * with them, so advancing the clock drives the queue deterministically.
 *
 * The regression under test: the slot wait used to poll
 * (`while (inFlight >= max) await sleep(50)`), so every queued caller woke on
 * the same timer, all saw the one free slot, and all proceeded — running
 * several Amazon page fetches at once under a maxConcurrent of 1.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withRateLimit, resetFetchState, HostBlockedError } from "../lib/fetchLog";

const AMAZON_URL = "https://www.amazon.com/dp/B00TEST123";

/** Runs the limiter over `count` calls, tracking peak simultaneous tasks. */
function trackConcurrency(url: string, count: number, taskMs = 10) {
  let inFlight = 0;
  let peak = 0;
  const order: number[] = [];

  const runs = Array.from({ length: count }, (_, i) =>
    withRateLimit(url, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      order.push(i);
      await new Promise((resolve) => setTimeout(resolve, taskMs));
      inFlight -= 1;
      return { value: i, status: 200 };
    })
  );

  return { runs, peak: () => peak, order };
}

describe("withRateLimit", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetFetchState();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetFetchState();
  });

  it("never runs more than one Amazon page fetch at a time", async () => {
    const { runs, peak } = trackConcurrency(AMAZON_URL, 6);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(runs);

    expect(peak()).toBe(1);
  });

  it("honours a higher concurrency cap without exceeding it", async () => {
    // completion.amazon.* is the autocomplete endpoint: maxConcurrent 8.
    const { runs, peak } = trackConcurrency("https://completion.amazon.com/api/2017/suggestions", 20);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(runs);

    expect(peak()).toBeLessThanOrEqual(8);
  });

  it("serves queued callers in FIFO order", async () => {
    const { runs, order } = trackConcurrency(AMAZON_URL, 5);

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(runs);

    expect(order).toEqual([0, 1, 2, 3, 4]);
  });

  it("spaces successive requests by the host's minimum interval", async () => {
    const startTimes: number[] = [];
    const runs = Array.from({ length: 3 }, () =>
      withRateLimit(AMAZON_URL, async () => {
        startTimes.push(Date.now());
        return { value: null, status: 200 };
      })
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.all(runs);

    expect(startTimes).toHaveLength(3);
    // Amazon policy is 1200ms between starts.
    expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(1200);
    expect(startTimes[2] - startTimes[1]).toBeGreaterThanOrEqual(1200);
  });

  it("releases the slot when a task throws, so the queue keeps draining", async () => {
    const failing = withRateLimit(AMAZON_URL, async () => {
      throw new Error("network down");
    }).catch((err: Error) => err.message);

    const following = withRateLimit(AMAZON_URL, async () => ({ value: "ran", status: 200 }));

    await vi.advanceTimersByTimeAsync(60_000);

    expect(await failing).toBe("network down");
    // Would hang forever if the failed call had leaked its slot.
    expect(await following).toBe("ran");
  });

  it("skips fetching a host inside its bot-check cool-down", async () => {
    // First call reports a bot check, tripping the breaker for this host.
    await withRateLimit(AMAZON_URL, async () => ({ value: null, status: 200, blocked: true }));

    await expect(
      withRateLimit(AMAZON_URL, async () => ({ value: "should not run", status: 200 }))
    ).rejects.toBeInstanceOf(HostBlockedError);
  });
});
