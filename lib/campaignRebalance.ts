/**
 * Update Campaign's "replace what isn't working" step (per user request on
 * top of campaigns spec §4/§6): combines imported results (lib/recommendations.ts'
 * archive rule), the live keyword/ASIN bank, and an optional LLM tie-breaker
 * to swap underperforming targets for the best untapped candidates from the
 * bank ("ready" — active, not already in this campaign), while keeping the
 * campaign's target count inside [MIN_CAMPAIGN_TARGETS, MAX_CAMPAIGN_TARGETS].
 *
 * Pure aside from the optional LLM call, which fails soft: any failure
 * (unconfigured, network, bad JSON) falls back to the score-only order, so
 * this never blocks an Update Campaign run.
 */

import { callOpenRouterJson } from "./llmClient";
import { recommendForKeyword, recommendForCompetitorAsin, type KeywordPerformance } from "./recommendations";
import type { CampaignPlanTarget } from "./campaignBulksheetPlan";
import { MIN_CAMPAIGN_TARGETS, MAX_CAMPAIGN_TARGETS } from "./campaignSelection";

export { MIN_CAMPAIGN_TARGETS, MAX_CAMPAIGN_TARGETS };

export interface RebalanceCandidate {
  keywordId?: string;
  competitorAsinId?: string;
  text: string;
  matchType?: CampaignPlanTarget["matchType"];
  targetingExpression?: string;
  bid: number | null;
  adGroup: string;
  /** Score used to rank replacements when the LLM is unavailable/declines — higher is better. */
  score: number;
}

export interface RebalanceResult {
  targets: CampaignPlanTarget[];
  removed: Array<{ text: string; reason: string }>;
  added: Array<{ text: string; reason: string }>;
}

function candidateKey(t: { keywordId?: string; competitorAsinId?: string; text: string }): string {
  return t.keywordId ? `k:${t.keywordId}` : t.competitorAsinId ? `a:${t.competitorAsinId}` : `t:${t.text}`;
}

function toPlanTarget(c: RebalanceCandidate): CampaignPlanTarget {
  return {
    keywordId: c.keywordId,
    competitorAsinId: c.competitorAsinId,
    text: c.text,
    matchType: c.matchType,
    targetingExpression: c.targetingExpression,
    bid: c.bid,
    adGroup: c.adGroup,
  };
}

/** True when performance data says this target has spent real clicks without ever converting — the "archive" rule from lib/recommendations.ts. */
function isUnderperforming(id: string, isAsin: boolean, performanceById: Map<string, KeywordPerformance>, targetAcos: number): string | null {
  const perf = performanceById.get(id);
  if (!perf) return null;
  const recs = isAsin ? recommendForCompetitorAsin(perf, targetAcos) : recommendForKeyword(perf, targetAcos);
  const archive = recs.find((r) => r.type === "archive");
  return archive?.reason ?? null;
}

/**
 * Asks the LLM to rank replacement candidates for a campaign, given the
 * book's context and why the removed targets underperformed. Returns
 * candidate texts in the LLM's preferred order, or null on any failure so
 * the caller falls back to `score` order.
 */
async function llmRankReplacements(
  campaignName: string,
  removedTexts: string[],
  candidates: RebalanceCandidate[]
): Promise<string[] | null> {
  if (candidates.length === 0) return null;
  const result = await callOpenRouterJson<{ order: string[] }>(
    [
      {
        role: "system",
        content:
          "You rank Amazon Ads targeting candidates (keywords or competitor ASINs) for a book advertising campaign. " +
          "Return the candidate texts most likely to convert first, best first, as JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          campaign: campaignName,
          replacing: removedTexts,
          candidates: candidates.map((c) => c.text),
        }),
      },
    ],
    {
      label: "campaignRebalance",
      schema: {
        name: "ranked_replacements",
        schema: {
          type: "object",
          properties: { order: { type: "array", items: { type: "string" } } },
          required: ["order"],
        },
      },
    }
  );
  if (!result || !Array.isArray(result.order)) return null;
  return result.order;
}

export interface RebalanceInput {
  campaignName: string;
  current: RebalanceCandidate[];
  /** The book's active bank not currently in this campaign — the "ready" replacement pool. */
  ready: RebalanceCandidate[];
  performanceById: Map<string, KeywordPerformance>;
  targetAcos: number;
  useLlm?: boolean;
  min?: number;
  max?: number;
}

/**
 * Replaces underperforming targets with the best "ready" candidates, then
 * tops up or trims so the final count sits in [min, max]. Data (lifetime
 * clicks/orders via recommendForKeyword/Asin) always decides *what's*
 * underperforming; the LLM, when configured, only re-orders which ready
 * candidates fill the resulting slots — it never overrides the data-driven
 * removal.
 */
export async function rebalanceCampaignTargets(input: RebalanceInput): Promise<RebalanceResult> {
  const min = input.min ?? MIN_CAMPAIGN_TARGETS;
  const max = input.max ?? MAX_CAMPAIGN_TARGETS;

  const flagged: Array<{ target: RebalanceCandidate; reason: string }> = [];
  const keep: RebalanceCandidate[] = [];

  for (const t of input.current) {
    const id = t.keywordId ?? t.competitorAsinId;
    const isAsin = !!t.competitorAsinId;
    const reason = id ? isUnderperforming(id, isAsin, input.performanceById, input.targetAcos) : null;
    if (reason) flagged.push({ target: t, reason });
    else keep.push(t);
  }

  const keptKeys = new Set(keep.map(candidateKey));
  let pool = input.ready.filter((c) => !keptKeys.has(candidateKey(c)));

  // Only swap out an underperformer if a replacement actually exists —
  // never shrink below `min` for lack of fresh candidates. Anything flagged
  // beyond the available pool size stays in the campaign.
  const swappableRemovedCount = Math.min(flagged.length, pool.length);
  const removed = flagged.slice(0, swappableRemovedCount).map((f) => ({ text: f.target.text, reason: f.reason }));
  for (const f of flagged.slice(swappableRemovedCount)) keep.push(f.target);

  const slotsNeeded = Math.max(0, min - (keep.length + swappableRemovedCount)) + swappableRemovedCount;
  const wantReplacements = Math.min(pool.length, Math.max(slotsNeeded, keep.length < min ? min - keep.length : 0));

  pool = [...pool].sort((a, b) => b.score - a.score);

  let orderedTexts: string[] | null = null;
  if (input.useLlm && pool.length > 0) {
    orderedTexts = await llmRankReplacements(
      input.campaignName,
      removed.map((r) => r.text),
      pool.slice(0, Math.max(wantReplacements * 2, wantReplacements))
    );
  }

  let orderedPool = pool;
  if (orderedTexts) {
    const byText = new Map(pool.map((c) => [c.text, c]));
    const llmOrdered = orderedTexts.map((t) => byText.get(t)).filter((c): c is RebalanceCandidate => !!c);
    const remaining = pool.filter((c) => !orderedTexts!.includes(c.text));
    orderedPool = [...llmOrdered, ...remaining];
  }

  const added = orderedPool.slice(0, wantReplacements);
  let targets = [...keep, ...added];

  // Top up further if still short of min (e.g. nothing was flagged as underperforming).
  if (targets.length < min) {
    const usedKeys = new Set(targets.map(candidateKey));
    for (const c of orderedPool) {
      if (targets.length >= min) break;
      if (usedKeys.has(candidateKey(c))) continue;
      targets.push(c);
      usedKeys.add(candidateKey(c));
    }
  }

  // Trim to max, keeping the highest-scoring targets (kept ones score above any dropped underperformer implicitly since they weren't flagged).
  if (targets.length > max) {
    targets = [...targets].sort((a, b) => b.score - a.score).slice(0, max);
  }

  return {
    targets: targets.map(toPlanTarget),
    removed,
    added: added.filter((c) => targets.includes(c)).map((c) => ({ text: c.text, reason: "replacement from ready pool" })),
  };
}
