import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rebalanceCampaignTargets,
  keywordRebalanceScore,
  asinRebalanceScore,
  MIN_CAMPAIGN_TARGETS,
  MAX_CAMPAIGN_TARGETS,
  type RebalanceCandidate,
} from "../lib/campaignRebalance";
import { callOpenRouterJson } from "../lib/llmClient";
import type { KeywordPerformance } from "../lib/recommendations";
import type { BookAnchors } from "../lib/keywordAnchors";

vi.mock("../lib/llmClient", () => ({
  callOpenRouterJson: vi.fn(async () => null),
}));

const mockLlm = vi.mocked(callOpenRouterJson);

beforeEach(() => {
  mockLlm.mockReset();
  mockLlm.mockResolvedValue(null);
});

function perf(id: string, overrides: Partial<KeywordPerformance> = {}): KeywordPerformance {
  return {
    id,
    bid: 0.5,
    status: "active",
    resultsUpdatedAt: "2026-01-01T00:00:00Z",
    lifetimeClicks: 0,
    lifetimeOrders: 0,
    lifetimeSpend: 0,
    lastClicks: 0,
    lastSpend: 0,
    lastSales: 0,
    lastOrders: 0,
    ...overrides,
  };
}

function candidate(id: string, score = 1): RebalanceCandidate {
  return { keywordId: id, text: `kw-${id}`, matchType: "exact", bid: 0.5, adGroup: "Alpha Exact", score };
}

const anchors: BookAnchors = {
  bookSpecific: ["scars of the past"],
  genre: ["crime", "thriller"],
  setting: ["scotland"],
  comps: [],
  bookIntent: ["book", "books", "kindle"],
  primaryGenrePhrase: "scottish crime thriller",
};

describe("rebalanceCampaignTargets", () => {
  it("swaps an underperformer (30+ clicks, 0 orders, real spend) for the best ready candidate", async () => {
    const current = [candidate("bad"), ...Array.from({ length: 14 }, (_, i) => candidate(`ok${i}`))];
    const performanceById = new Map<string, KeywordPerformance>([
      ["bad", perf("bad", { lifetimeClicks: 40, lifetimeOrders: 0, lifetimeSpend: 12 })],
    ]);
    const ready = [candidate("new1", 5), candidate("new2", 3)];

    const result = await rebalanceCampaignTargets({
      campaignName: "Test - Alpha Exact",
      current,
      ready,
      performanceById,
      targetAcos: 0.3,
    });

    expect(result.removed.map((r) => r.text)).toEqual(["kw-bad"]);
    expect(result.targets.some((t) => t.text === "kw-bad")).toBe(false);
    expect(result.targets.some((t) => t.text === "kw-new1")).toBe(true);
    expect(result.targets).toHaveLength(15);
  });

  it("never drops below MIN_CAMPAIGN_TARGETS even with no ready replacements", async () => {
    const current = Array.from({ length: 15 }, (_, i) => candidate(`ok${i}`));
    const performanceById = new Map<string, KeywordPerformance>([
      ["ok0", perf("ok0", { lifetimeClicks: 40, lifetimeOrders: 0, lifetimeSpend: 12 })],
    ]);

    const result = await rebalanceCampaignTargets({
      campaignName: "Test",
      current,
      ready: [],
      performanceById,
      targetAcos: 0.3,
    });

    expect(result.targets.length).toBeGreaterThanOrEqual(MIN_CAMPAIGN_TARGETS);
    // Nothing was swapped out since there was nothing to replace it with.
    expect(result.targets.some((t) => t.text === "kw-ok0")).toBe(true);
  });

  it("tops up when starting below the minimum", async () => {
    const current = Array.from({ length: 10 }, (_, i) => candidate(`ok${i}`));
    const ready = Array.from({ length: 10 }, (_, i) => candidate(`new${i}`, 10 - i));

    const result = await rebalanceCampaignTargets({
      campaignName: "Test",
      current,
      ready,
      performanceById: new Map(),
      targetAcos: 0.3,
    });

    expect(result.targets.length).toBe(MIN_CAMPAIGN_TARGETS);
  });

  it("trims down to the maximum, keeping the highest scoring targets", async () => {
    const current = Array.from({ length: 20 }, (_, i) => candidate(`ok${i}`, i));
    const ready = Array.from({ length: 10 }, (_, i) => candidate(`new${i}`, 100 + i));

    const result = await rebalanceCampaignTargets({
      campaignName: "Test",
      current,
      ready,
      performanceById: new Map(),
      targetAcos: 0.3,
    });

    expect(result.targets.length).toBeLessThanOrEqual(MAX_CAMPAIGN_TARGETS);
  });

  // The model's ordering is untrusted output. Naming one candidate several
  // times used to resolve to the same pool entry each time, letting it fill
  // more than one replacement slot and ship as a duplicate target.
  it("does not duplicate a target when the LLM names the same candidate twice", async () => {
    mockLlm.mockResolvedValue({ order: ["kw-new1", "kw-new1", "kw-new1", "kw-new2"] });

    const current = Array.from({ length: 10 }, (_, i) => candidate(`ok${i}`));
    const ready = [candidate("new1", 5), candidate("new2", 4), candidate("new3", 3), candidate("new4", 2), candidate("new5", 1)];

    const result = await rebalanceCampaignTargets({
      campaignName: "Test",
      current,
      ready,
      performanceById: new Map(),
      targetAcos: 0.3,
      useLlm: true,
    });

    const texts = result.targets.map((t) => t.text);
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.filter((t) => t === "kw-new1")).toHaveLength(1);
    expect(result.targets).toHaveLength(MIN_CAMPAIGN_TARGETS);
  });

  it("ignores LLM-named candidates that aren't in the ready pool", async () => {
    mockLlm.mockResolvedValue({ order: ["kw-does-not-exist", "kw-new2"] });

    const current = Array.from({ length: 14 }, (_, i) => candidate(`ok${i}`));
    const ready = [candidate("new1", 5), candidate("new2", 4)];

    const result = await rebalanceCampaignTargets({
      campaignName: "Test",
      current,
      ready,
      performanceById: new Map(),
      targetAcos: 0.3,
      useLlm: true,
    });

    const texts = result.targets.map((t) => t.text);
    expect(texts).not.toContain("kw-does-not-exist");
    expect(texts).toContain("kw-new2");
    expect(new Set(texts).size).toBe(texts.length);
  });

  // A trim-to-max compares `current`'s score against `ready`'s (see
  // keywordRebalanceScore/asinRebalanceScore doc comment in
  // lib/campaignRebalance.ts). If a caller ever scores `current` as a flat
  // placeholder again, this catches it: an established, non-underperforming
  // target must not lose its slot to an unproven ready candidate.
  it("keeps an established target over a ready candidate when trimming to max, given comparable scores", async () => {
    const establishedScore = keywordRebalanceScore(
      { text: "scottish crime thriller", sources: ["genre-metadata"], matchType: "phrase", bid: 0.5 },
      anchors,
      5 // has real lifetime orders
    );
    const readyScore = keywordRebalanceScore(
      { text: "some unproven phrase", sources: ["synonym"], matchType: "broad", bid: 0.4 },
      anchors,
      0 // no performance history yet
    );
    expect(establishedScore).toBeGreaterThan(readyScore);

    const current = Array.from({ length: MAX_CAMPAIGN_TARGETS }, (_, i) => ({
      keywordId: `established${i}`,
      text: `kw-established${i}`,
      matchType: "exact" as const,
      bid: 0.5,
      adGroup: "Alpha Exact",
      score: establishedScore,
    }));
    const ready = [candidate("unproven", readyScore)];

    const result = await rebalanceCampaignTargets({
      campaignName: "Test",
      current,
      ready,
      performanceById: new Map(),
      targetAcos: 0.3,
    });

    expect(result.targets.length).toBe(MAX_CAMPAIGN_TARGETS);
    expect(result.targets.some((t) => t.text === "kw-unproven")).toBe(false);
    expect(result.targets.every((t) => t.text.startsWith("kw-established"))).toBe(true);
  });
});

describe("keywordRebalanceScore / asinRebalanceScore", () => {
  it("weights real lifetime orders far above a bare relevance score", () => {
    const noOrders = keywordRebalanceScore(
      { text: "scottish crime thriller", sources: ["genre-metadata"], matchType: "phrase", bid: 0.5 },
      anchors,
      0
    );
    const withOrders = keywordRebalanceScore(
      { text: "scottish crime thriller", sources: ["genre-metadata"], matchType: "phrase", bid: 0.5 },
      anchors,
      3
    );
    expect(withOrders).toBe(noOrders + 30);
  });

  it("treats undefined/null lifetimeOrders as zero", () => {
    const base = { text: "scottish crime thriller", sources: ["genre-metadata" as const], matchType: "phrase" as const, bid: 0.5 };
    expect(keywordRebalanceScore(base, anchors, undefined)).toBe(keywordRebalanceScore(base, anchors, 0));
    expect(keywordRebalanceScore(base, anchors, null)).toBe(keywordRebalanceScore(base, anchors, 0));
  });

  it("scores a stronger (lower) mean discovery rank higher", () => {
    expect(asinRebalanceScore(2, 0)).toBeGreaterThan(asinRebalanceScore(50, 0));
  });

  it("defaults a missing mean rank to the weakest tier (999) rather than the strongest", () => {
    expect(asinRebalanceScore(undefined, 0)).toBe(asinRebalanceScore(999, 0));
    expect(asinRebalanceScore(null, 0)).toBeLessThan(asinRebalanceScore(1, 0));
  });

  it("lets real lifetime orders outweigh a weak mean rank", () => {
    const weakRankNoOrders = asinRebalanceScore(200, 0);
    const weakRankWithOrders = asinRebalanceScore(200, 2);
    expect(weakRankWithOrders).toBe(weakRankNoOrders + 20);
  });
});
