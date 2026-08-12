import { describe, expect, it, vi } from "vitest";
import { rebalanceCampaignTargets, MIN_CAMPAIGN_TARGETS, MAX_CAMPAIGN_TARGETS, type RebalanceCandidate } from "../lib/campaignRebalance";
import type { KeywordPerformance } from "../lib/recommendations";

vi.mock("../lib/llmClient", () => ({
  callOpenRouterJson: vi.fn(async () => null),
}));

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
});
