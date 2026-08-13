/**
 * Assembles the 5-campaign structure's targets and negatives from
 * lib/campaignSelection.ts's five selectors (campaigns spec §3/§4). Pure,
 * no I/O — the output feeds both the campaign_targets DB rows and the
 * bulksheet export (lib/campaignBulksheetExport.ts), so campaign selection
 * only ever happens once per Create Campaign run.
 *
 * Skips any campaign with zero eligible targets rather than creating a
 * $25/day campaign with nothing in it (spec §4 step 5).
 */

import {
  AUTO_BUDGET_MIN,
  AUTO_BUDGET_RATIO,
  AUTO_TARGETING_GROUPS,
  campaignName,
} from "./bulksheet";
import {
  DEFAULT_EXCLUSION,
  MAX_CAMPAIGN_TARGETS,
  selectAlphaExactKeywords,
  selectBmmDiscoveryKeywords,
  selectBrandGuardKeywords,
  selectCatalogCrossSellTargets,
  selectRivalAsinTargets,
  SINGLE_AD_GROUP_LABEL,
  type CampaignBook,
  type CampaignType,
  type KeywordWithRollups,
  type RivalExclusionRules,
} from "./campaignSelection";
import { callOpenRouterJson, isOpenRouterConfigured } from "./llmClient";
import type { BookAnchors } from "./keywordAnchors";
import { fitNegativeMatchType, type NegativeKeyword } from "./negativeKeywords";
import type { CompetitorAsin, MatchType } from "./types";

/**
 * When a selector's eligible pool exceeds MAX_CAMPAIGN_TARGETS, ask
 * OpenRouter to pick the best `max` out of a wider candidate pool rather
 * than mechanically keeping the selector's own sort order — mirrors
 * lib/campaignRebalance.ts's `llmRankReplacements` fail-soft pattern.
 * Falls back to the candidates' existing (already best-first) order when
 * OpenRouter isn't configured or the call fails.
 */
async function refineToBest<T extends { text: string }>(
  campaignLabel: string,
  book: CampaignBook,
  candidates: T[],
  max: number
): Promise<T[]> {
  if (candidates.length <= max || !isOpenRouterConfigured()) return candidates.slice(0, max);

  const pool = candidates.slice(0, max * 2);
  const result = await callOpenRouterJson<{ order: string[] }>(
    [
      {
        role: "system",
        content:
          "You pick the best Amazon Ads targeting candidates (keywords or competitor ASINs) for a new book " +
          "advertising campaign. Return the best `pick` candidate texts, best first, as JSON only.",
      },
      {
        role: "user",
        content: JSON.stringify({
          campaign: campaignLabel,
          book: { title: book.title, author: book.author },
          candidates: pool.map((c) => c.text),
          pick: max,
        }),
      },
    ],
    {
      label: "campaignBulksheetPlan",
      schema: {
        name: "ranked_targets",
        schema: {
          type: "object",
          properties: { order: { type: "array", items: { type: "string" } } },
          required: ["order"],
        },
      },
    }
  ).catch(() => null);

  if (!result || !Array.isArray(result.order) || result.order.length === 0) return candidates.slice(0, max);

  const byText = new Map(pool.map((c) => [c.text, c]));
  const picked: T[] = [];
  const used = new Set<string>();
  for (const text of result.order) {
    const c = byText.get(text);
    if (c && !used.has(text)) {
      picked.push(c);
      used.add(text);
      if (picked.length >= max) break;
    }
  }
  if (picked.length < max) {
    for (const c of candidates) {
      if (picked.length >= max) break;
      if (!used.has(c.text)) {
        picked.push(c);
        used.add(c.text);
      }
    }
  }
  return picked;
}

/** Decision 2 (docs/CAMPAIGNS-PROGRESS.md): $25/campaign default. */
export const DEFAULT_DAILY_BUDGET_PER_CAMPAIGN = 25;

export interface CampaignPlanTarget {
  keywordId?: string;
  competitorAsinId?: string;
  text: string;
  matchType?: MatchType;
  targetingExpression?: string;
  bid: number | null;
  /** Every campaign has one ad group except Auto Discovery, which has one per targeting group (close-match/substitutes/loose-match/complements). */
  adGroup: string;
}

export interface CampaignPlanNegative {
  text: string;
  matchType: Extract<MatchType, "phrase" | "exact">;
  reason: string;
  scope: "campaign" | "ad_group";
}

export interface CampaignPlan {
  campaignType: CampaignType;
  name: string;
  dailyBudget: number;
  targets: CampaignPlanTarget[];
  negatives: CampaignPlanNegative[];
}

export interface BuildCampaignPlansInput {
  book: CampaignBook;
  /** Active keywords for this book, joined with lifetime rollups for Alpha Exact ranking. */
  bank: KeywordWithRollups[];
  anchors: BookAnchors;
  asinBank: CompetitorAsin[];
  /** This user's other books, for Catalog Cross-Sell. */
  siblingBooks: CampaignBook[];
  /** Starter/library negatives (lib/negativeKeywords.ts + the negative keyword library) — always ad_group scope unless the entry itself says otherwise. */
  negatives: NegativeKeyword[];
  dailyBudgetPerCampaign?: number;
  rivalExclusionRules?: RivalExclusionRules;
  /** Decision 1: off by default — keeps today's search-term-harvesting engine until BMM Discovery has proven itself. */
  includeAutoDiscovery?: boolean;
  defaultBid?: number;
}

function toBaseNegatives(negatives: NegativeKeyword[]): CampaignPlanNegative[] {
  return negatives.map((n) => ({
    text: n.text,
    matchType: n.matchType,
    reason: n.reason,
    scope: n.scope ?? "ad_group",
  }));
}

/** Headroom passed to each selector so refineToBest has a real pool to choose the best MAX_CAMPAIGN_TARGETS from. */
const CANDIDATE_POOL_MULTIPLIER = 4;

export async function buildCampaignPlans(input: BuildCampaignPlansInput): Promise<CampaignPlan[]> {
  const dailyBudget = input.dailyBudgetPerCampaign ?? DEFAULT_DAILY_BUDGET_PER_CAMPAIGN;
  const defaultBid = input.defaultBid ?? 0.5;
  const rivalRules = input.rivalExclusionRules ?? DEFAULT_EXCLUSION;
  const baseNegatives = toBaseNegatives(input.negatives);
  const poolLimit = MAX_CAMPAIGN_TARGETS * CANDIDATE_POOL_MULTIPLIER;

  const plans: CampaignPlan[] = [];

  const brandGuard = await refineToBest(
    SINGLE_AD_GROUP_LABEL.brand_guard!,
    input.book,
    selectBrandGuardKeywords(input.bank, input.book, poolLimit),
    MAX_CAMPAIGN_TARGETS
  );
  if (brandGuard.length > 0) {
    plans.push({
      campaignType: "brand_guard",
      name: campaignName(input.book.title, SINGLE_AD_GROUP_LABEL.brand_guard!),
      dailyBudget,
      targets: brandGuard.map((k) => ({
        keywordId: k.id,
        text: k.text,
        matchType: k.matchType,
        bid: k.bid ?? defaultBid,
        adGroup: SINGLE_AD_GROUP_LABEL.brand_guard!,
      })),
      negatives: baseNegatives,
    });
  }

  const alphaExact = await refineToBest(
    SINGLE_AD_GROUP_LABEL.alpha_exact!,
    input.book,
    selectAlphaExactKeywords(input.bank, input.anchors, poolLimit),
    MAX_CAMPAIGN_TARGETS
  );
  if (alphaExact.length > 0) {
    plans.push({
      campaignType: "alpha_exact",
      name: campaignName(input.book.title, SINGLE_AD_GROUP_LABEL.alpha_exact!),
      dailyBudget,
      targets: alphaExact.map((k) => ({
        keywordId: k.id,
        text: k.text,
        matchType: k.matchType,
        bid: k.bid ?? defaultBid,
        adGroup: SINGLE_AD_GROUP_LABEL.alpha_exact!,
      })),
      negatives: baseNegatives,
    });
  }

  // Safeguard (spec §3): every Alpha Exact keyword becomes a campaign-level
  // negative-exact in *both* discovery campaigns, so a term that has been
  // promoted to its own Exact slot is never bid on twice.
  //
  // Built once here rather than inside the BMM block, because Auto Discovery
  // needs it at least as badly: BMM only matches the roots in its target
  // list, whereas Auto's four targeting groups (close, loose, substitutes,
  // complements) match semantically with no keyword list at all — so a
  // promoted term stays reachable there however the bank is filtered, and
  // Alpha Exact ends up bidding against Auto Discovery on the one query
  // that has actually proven it converts.
  //
  // Held to the negative-exact word limit for the same reason every other
  // negative is: an over-length row is rejected at upload.
  const alphaExactNegatives: CampaignPlanNegative[] = alphaExact.flatMap((k) =>
    fitNegativeMatchType(k.text, "exact") === "exact"
      ? [{ text: k.text, matchType: "exact" as const, reason: "Alpha Exact promotion safeguard", scope: "campaign" as const }]
      : []
  );

  const bmmDiscoveryTargets = selectBmmDiscoveryKeywords(input.bank, alphaExact, brandGuard, poolLimit);
  const bmmDiscovery = await refineToBest(
    SINGLE_AD_GROUP_LABEL.bmm_discovery!,
    input.book,
    bmmDiscoveryTargets,
    MAX_CAMPAIGN_TARGETS
  );
  if (bmmDiscovery.length > 0) {
    const bidByKeywordId = new Map(input.bank.map((k) => [k.id, k.bid]));
    plans.push({
      campaignType: "bmm_discovery",
      name: campaignName(input.book.title, SINGLE_AD_GROUP_LABEL.bmm_discovery!),
      dailyBudget,
      targets: bmmDiscovery.map((t) => ({
        keywordId: t.rootKeywordId,
        text: t.text,
        matchType: "broad" as const,
        bid: bidByKeywordId.get(t.rootKeywordId) ?? defaultBid,
        adGroup: SINGLE_AD_GROUP_LABEL.bmm_discovery!,
      })),
      negatives: [...baseNegatives, ...alphaExactNegatives],
    });
  }

  const rivalAsinCandidates = selectRivalAsinTargets(input.asinBank, rivalRules, poolLimit).map((a) => ({
    asin: a,
    text: `asin="${a.competitor_asin}"`,
  }));
  const rivalAsins = (
    await refineToBest(SINGLE_AD_GROUP_LABEL.rival_asin_offensive!, input.book, rivalAsinCandidates, MAX_CAMPAIGN_TARGETS)
  ).map((c) => c.asin);
  if (rivalAsins.length > 0) {
    plans.push({
      campaignType: "rival_asin_offensive",
      name: campaignName(input.book.title, SINGLE_AD_GROUP_LABEL.rival_asin_offensive!),
      dailyBudget,
      targets: rivalAsins.map((a) => {
        const expr = `asin="${a.competitor_asin}"`;
        return {
          competitorAsinId: a.id,
          text: expr,
          targetingExpression: expr,
          bid: a.bid ?? defaultBid,
          adGroup: SINGLE_AD_GROUP_LABEL.rival_asin_offensive!,
        };
      }),
      negatives: baseNegatives,
    });
  }

  const crossSell = selectCatalogCrossSellTargets(input.siblingBooks, input.book);
  if (crossSell.length > 0) {
    plans.push({
      campaignType: "catalog_cross_sell",
      name: campaignName(input.book.title, SINGLE_AD_GROUP_LABEL.catalog_cross_sell!),
      dailyBudget,
      targets: crossSell.map((t) => {
        const expr = `asin="${t.asin}"`;
        return { text: expr, targetingExpression: expr, bid: defaultBid, adGroup: SINGLE_AD_GROUP_LABEL.catalog_cross_sell! };
      }),
      negatives: baseNegatives,
    });
  }

  if (input.includeAutoDiscovery && input.bank.length > 0) {
    const autoBudget = Math.max(AUTO_BUDGET_MIN, Math.round(dailyBudget * AUTO_BUDGET_RATIO * 100) / 100);
    plans.push({
      campaignType: "auto_discovery",
      name: campaignName(input.book.title, "Auto Discovery"),
      dailyBudget: autoBudget,
      targets: AUTO_TARGETING_GROUPS.map((group) => {
        const expr = `targetingExpression="${group.expression}"`;
        return { text: expr, targetingExpression: expr, bid: defaultBid * group.bidMultiplier, adGroup: group.label };
      }),
      negatives: [...baseNegatives, ...alphaExactNegatives],
    });
  }

  return plans;
}
