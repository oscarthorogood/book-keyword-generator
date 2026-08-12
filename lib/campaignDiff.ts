/**
 * Diffs a campaign's last-exported targets (campaign_targets) against its
 * current live targets (freshly re-run selection) for Update Campaign
 * (campaigns spec §4). Pure — no I/O.
 *
 * - In snapshot, still live, bid/state changed -> Update
 * - Not in snapshot, now live -> Create
 * - In snapshot, no longer live (archived/negative/deselected) -> Archive
 * - In snapshot, still live, nothing changed -> no row at all (an Update
 *   file full of no-op rows is how you reset bids Amazon has been
 *   optimising — spec's explicit fourth case).
 *
 * Diffs by id, never by text, per the spec — `targetKey()` uses
 * keywordId/competitorAsinId when present. Catalog Cross-Sell and Auto
 * Discovery targets have neither (their targets are sibling-book ASINs and
 * synthetic auto-targeting expressions, with no persisted row of their own
 * in this schema to key on), so those two campaign types fall back to
 * `text` as a documented exception, not a relaxation of the rule for the
 * four campaign types that do have real ids.
 */

import type { MatchType } from "./types";

export interface DiffCampaignTarget {
  keywordId?: string;
  competitorAsinId?: string;
  text: string;
  matchType?: MatchType;
  targetingExpression?: string;
  bid: number | null;
  state: "enabled" | "paused" | "archived";
}

export interface DiffedCampaignTarget extends DiffCampaignTarget {
  operation: "Update" | "Create" | "Archive";
}

export function targetKey(target: DiffCampaignTarget): string {
  return target.keywordId ?? target.competitorAsinId ?? target.text;
}

export function diffCampaignTargets(
  snapshot: DiffCampaignTarget[],
  current: DiffCampaignTarget[]
): DiffedCampaignTarget[] {
  const snapshotByKey = new Map(snapshot.map((t) => [targetKey(t), t]));
  const currentByKey = new Map(current.map((t) => [targetKey(t), t]));
  const diffed: DiffedCampaignTarget[] = [];

  for (const [key, currentTarget] of currentByKey) {
    const snapshotTarget = snapshotByKey.get(key);
    if (!snapshotTarget) {
      diffed.push({ ...currentTarget, operation: "Create" });
      continue;
    }
    const changed = snapshotTarget.bid !== currentTarget.bid || snapshotTarget.state !== currentTarget.state;
    if (changed) {
      diffed.push({ ...currentTarget, operation: "Update" });
    }
    // Unchanged: no row at all.
  }

  for (const [key, snapshotTarget] of snapshotByKey) {
    if (!currentByKey.has(key)) {
      diffed.push({ ...snapshotTarget, state: "archived", operation: "Archive" });
    }
  }

  return diffed;
}
