/**
 * Fetch auditing, rate limiting and CAPTCHA back-off for outbound page
 * fetches.
 *
 * Scraping Amazon at scale violates their terms of service. This app is
 * low-volume manual research — one capture per book the user adds — and the
 * preferred path is an official/licensed source (SerpApi's Amazon APIs, the
 * Amazon Ads API, Firecrawl) with the direct fetch as the fallback. What
 * this module adds is the discipline that keeps it that way:
 *
 *  - every fetch is logged (URL, status, duration, outcome) for auditability;
 *  - per-host rate limiting spaces requests out and caps concurrency;
 *  - a bot-check trips a circuit breaker, so a blocked host is left alone for
 *    a cool-down instead of being hammered into a harder block.
 *
 * State is per server instance and in-memory: serverless instances are
 * short-lived, so this bounds a single capture's burst rather than
 * pretending to be a global quota.
 */

export interface FetchLogEntry {
  url: string;
  host: string;
  status?: number;
  durationMs: number;
  at: string;
  outcome: "ok" | "error" | "blocked" | "skipped";
  note?: string;
}

const MAX_LOG_ENTRIES = 200;
const log: FetchLogEntry[] = [];

/** Recent fetches, newest last. Bounded so a long-running instance can't grow without limit. */
export function recentFetchLog(limit = 50): FetchLogEntry[] {
  return log.slice(-limit);
}

/**
 * Records a fetch. Every attempt lands in the in-memory audit log; the
 * console only gets the anomalies (a block, an error, a non-2xx), unless
 * DEBUG_FETCH_LOG is set — a routine capture makes dozens of requests and
 * logging all of them buries everything else.
 */
export function recordFetch(entry: FetchLogEntry): void {
  log.push(entry);
  if (log.length > MAX_LOG_ENTRIES) log.splice(0, log.length - MAX_LOG_ENTRIES);

  const status = entry.status ? ` ${entry.status}` : "";
  const note = entry.note ? ` — ${entry.note}` : "";
  const line = `[fetch] ${entry.outcome}${status} ${entry.durationMs}ms ${entry.url}${note}`;

  if (entry.outcome === "ok") {
    if (process.env.DEBUG_FETCH_LOG) console.warn(line);
    return;
  }
  console.warn(line);
}

// --- rate limiting --------------------------------------------------------

interface HostPolicy {
  /** Minimum gap between two requests to the same host. */
  minIntervalMs: number;
  /** Requests allowed in flight at once. */
  maxConcurrent: number;
}

const DEFAULT_POLICY: HostPolicy = { minIntervalMs: 400, maxConcurrent: 4 };

/**
 * Amazon product pages are the sensitive target: spaced widest and kept
 * effectively serial. The autocomplete JSON endpoints are a different
 * service with a much higher tolerance, and the paid APIs police themselves.
 */
const HOST_POLICIES: Array<{ pattern: RegExp; policy: HostPolicy }> = [
  { pattern: /(^|\.)amazon\.[a-z.]+$/i, policy: { minIntervalMs: 1200, maxConcurrent: 1 } },
  { pattern: /completion\.amazon\.[a-z.]+$/i, policy: { minIntervalMs: 120, maxConcurrent: 8 } },
  { pattern: /(^|\.)goodreads\.com$/i, policy: { minIntervalMs: 1000, maxConcurrent: 1 } },
  { pattern: /(^|\.)serpapi\.com$/i, policy: { minIntervalMs: 200, maxConcurrent: 4 } },
  { pattern: /(^|\.)scraperapi\.com$/i, policy: { minIntervalMs: 200, maxConcurrent: 4 } },
];

interface HostState {
  lastStartedAt: number;
  inFlight: number;
  /** Set when a bot check was seen; no further fetches until this passes. */
  blockedUntil: number;
  consecutiveBlocks: number;
}

const hostStates = new Map<string, HostState>();

function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return "unknown";
  }
}

function policyFor(host: string): HostPolicy {
  return HOST_POLICIES.find(({ pattern }) => pattern.test(host))?.policy ?? DEFAULT_POLICY;
}

function stateFor(host: string): HostState {
  let state = hostStates.get(host);
  if (!state) {
    state = { lastStartedAt: 0, inFlight: 0, blockedUntil: 0, consecutiveBlocks: 0 };
    hostStates.set(host, state);
  }
  return state;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Cool-down after a bot check, doubling with each consecutive block (capped). */
const BASE_BLOCK_COOLDOWN_MS = 60_000;
const MAX_BLOCK_COOLDOWN_MS = 15 * 60_000;

/** True when the host is inside a CAPTCHA cool-down and must not be fetched. */
export function isHostBlocked(url: string): boolean {
  const state = hostStates.get(hostOf(url));
  return !!state && state.blockedUntil > Date.now();
}

/**
 * Records that a host served a bot/CAPTCHA check. The caller aborts; this
 * makes sure the *next* caller doesn't immediately try again.
 */
export function reportBotCheck(url: string): void {
  const host = hostOf(url);
  const state = stateFor(host);
  state.consecutiveBlocks += 1;
  const cooldown = Math.min(BASE_BLOCK_COOLDOWN_MS * 2 ** (state.consecutiveBlocks - 1), MAX_BLOCK_COOLDOWN_MS);
  state.blockedUntil = Date.now() + cooldown;
  console.warn(
    `[fetch] ${host} served a bot check (${state.consecutiveBlocks} in a row) — pausing fetches to it for ${Math.round(cooldown / 1000)}s`
  );
}

/** Thrown instead of fetching when a host is inside its CAPTCHA cool-down. */
export class HostBlockedError extends Error {
  constructor(public readonly host: string, public readonly retryAfterMs: number) {
    super(`${host} is in a bot-check cool-down for another ${Math.round(retryAfterMs / 1000)}s`);
    this.name = "HostBlockedError";
  }
}

/**
 * Runs `task` under the host's rate limit, logging the outcome. `task`
 * reports back whether the response was a bot check so the breaker can trip
 * without this module having to know each site's block page.
 */
export async function withRateLimit<T>(
  url: string,
  task: () => Promise<{ value: T; status?: number; blocked?: boolean; note?: string }>
): Promise<T> {
  const host = hostOf(url);
  const state = stateFor(host);
  const policy = policyFor(host);
  const startedAt = Date.now();

  if (state.blockedUntil > Date.now()) {
    const retryAfterMs = state.blockedUntil - Date.now();
    recordFetch({
      url,
      host,
      durationMs: 0,
      at: new Date().toISOString(),
      outcome: "skipped",
      note: `host in bot-check cool-down for another ${Math.round(retryAfterMs / 1000)}s`,
    });
    throw new HostBlockedError(host, retryAfterMs);
  }

  // Wait for a concurrency slot, then for the minimum gap since the last start.
  while (state.inFlight >= policy.maxConcurrent) {
    await sleep(50);
  }
  const sinceLast = Date.now() - state.lastStartedAt;
  if (sinceLast < policy.minIntervalMs) await sleep(policy.minIntervalMs - sinceLast);

  state.inFlight += 1;
  state.lastStartedAt = Date.now();

  try {
    const result = await task();
    if (result.blocked) {
      reportBotCheck(url);
      recordFetch({
        url,
        host,
        status: result.status,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
        outcome: "blocked",
        note: result.note,
      });
    } else {
      state.consecutiveBlocks = 0;
      recordFetch({
        url,
        host,
        status: result.status,
        durationMs: Date.now() - startedAt,
        at: new Date().toISOString(),
        outcome: "ok",
        note: result.note,
      });
    }
    return result.value;
  } catch (err) {
    recordFetch({
      url,
      host,
      durationMs: Date.now() - startedAt,
      at: new Date().toISOString(),
      outcome: "error",
      note: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    state.inFlight -= 1;
  }
}

/** Clears rate-limit/breaker state. Tests only. */
export function resetFetchState(): void {
  hostStates.clear();
  log.length = 0;
}
