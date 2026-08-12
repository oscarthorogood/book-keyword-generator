import { describe, expect, it } from "vitest";
import { diffCampaignTargets, targetKey, type DiffCampaignTarget } from "../lib/campaignDiff";

function snap(overrides: Partial<DiffCampaignTarget> = {}): DiffCampaignTarget {
  return {
    keywordId: "kw-1",
    text: "cozy mystery series",
    matchType: "exact",
    bid: 0.5,
    state: "enabled",
    ...overrides,
  };
}

describe("targetKey", () => {
  it("keys by keywordId or competitorAsinId when present", () => {
    expect(targetKey({ keywordId: "kw-1", text: "x" } as DiffCampaignTarget)).toBe("kw-1");
    expect(targetKey({ competitorAsinId: "asin-1", text: "x" } as DiffCampaignTarget)).toBe("asin-1");
  });

  it("falls back to text for id-less targets (catalog cross-sell / auto discovery synthetic targets)", () => {
    expect(targetKey({ text: 'asin="B0SIBLING1"' } as DiffCampaignTarget)).toBe('asin="B0SIBLING1"');
  });
});

describe("diffCampaignTargets (campaigns spec §4 Update)", () => {
  it("emits no row at all when a snapshot target is unchanged and still live", () => {
    const snapshot = [snap()];
    const current = [snap()];
    expect(diffCampaignTargets(snapshot, current)).toEqual([]);
  });

  it("emits Update when the bid changed", () => {
    const snapshot = [snap({ bid: 0.5 })];
    const current = [snap({ bid: 0.75 })];
    const diffed = diffCampaignTargets(snapshot, current);
    expect(diffed).toEqual([expect.objectContaining({ operation: "Update", bid: 0.75, keywordId: "kw-1" })]);
  });

  it("emits Update when the state changed (e.g. paused)", () => {
    const snapshot = [snap({ state: "enabled" })];
    const current = [snap({ state: "paused" })];
    const diffed = diffCampaignTargets(snapshot, current);
    expect(diffed).toEqual([expect.objectContaining({ operation: "Update", state: "paused" })]);
  });

  it("emits Create for a target in the current live set but not in the snapshot", () => {
    const snapshot: DiffCampaignTarget[] = [];
    const current = [snap({ keywordId: "kw-new" })];
    const diffed = diffCampaignTargets(snapshot, current);
    expect(diffed).toEqual([expect.objectContaining({ operation: "Create", keywordId: "kw-new" })]);
  });

  it("emits Archive for a snapshot target no longer in the current live set", () => {
    const snapshot = [snap({ keywordId: "kw-gone" })];
    const current: DiffCampaignTarget[] = [];
    const diffed = diffCampaignTargets(snapshot, current);
    expect(diffed).toEqual([expect.objectContaining({ operation: "Archive", keywordId: "kw-gone" })]);
  });

  it("mixes Update/Create/Archive/no-op correctly across a batch", () => {
    const snapshot = [
      snap({ keywordId: "unchanged", bid: 0.5 }),
      snap({ keywordId: "changed", bid: 0.5 }),
      snap({ keywordId: "removed", bid: 0.5 }),
    ];
    const current = [
      snap({ keywordId: "unchanged", bid: 0.5 }),
      snap({ keywordId: "changed", bid: 0.9 }),
      snap({ keywordId: "added", bid: 0.4 }),
    ];
    const diffed = diffCampaignTargets(snapshot, current);
    const byKeyword = new Map(diffed.map((d) => [d.keywordId, d.operation]));
    expect(byKeyword.get("changed")).toBe("Update");
    expect(byKeyword.get("added")).toBe("Create");
    expect(byKeyword.get("removed")).toBe("Archive");
    expect(byKeyword.has("unchanged")).toBe(false);
  });

  it("diffs by id, not text — two different ids with the same text are distinct targets", () => {
    const snapshot = [snap({ keywordId: "kw-a", text: "same text", bid: 0.5 })];
    const current = [snap({ keywordId: "kw-b", text: "same text", bid: 0.5 })];
    const diffed = diffCampaignTargets(snapshot, current);
    const byKeyword = new Map(diffed.map((d) => [d.keywordId, d.operation]));
    expect(byKeyword.get("kw-a")).toBe("Archive");
    expect(byKeyword.get("kw-b")).toBe("Create");
  });
});
