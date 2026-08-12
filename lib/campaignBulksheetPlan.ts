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
  selectAlphaExactKeywords,
  selectBmmDiscoveryKeywords,
  selectBrandGuardKeywords,
  selectCatalogCrossSellTargets,
  selectRivalAsinTargets,
  type CampaignBook,
  type CampaignType,
  type KeywordWithRollups,
  type RivalExclusionRules,
} from "./campaignSelection";
import type { BookAnchors } from "./keywordAnchors";
import type { NegativeKeyword } from "./negativeKeywords";
import type { CompetitorAsin, MatchType } from "./types";

/** Decision 2 (docs/CAMPAIGNS-PROGRESS.md): $25/campaign default. */
export const DEFAULT_DAILY_BUDGET_PER_CAMPAIGN = 25;

export interface CampaignPlanTarget {
  keywordId?: string;
  competitorAsinId?: string;
  text: string;
  matchType?: MatchType;
  targetingExpression?: string;
  bid: number | null;
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

export function buildCampaignPlans(input: BuildCampaignPlansInput): CampaignPlan[] {
  const dailyBudget = input.dailyBudgetPerCampaign ?? DEFAULT_DAILY_BUDGET_PER_CAMPAIGN;
  const defaultBid = input.defaultBid ?? 0.5;
  const rivalRules = input.rivalExclusionRules ?? DEFAULT_EXCLUSION;
  const baseNegatives = toBaseNegatives(input.negatives);

  const plans: CampaignPlan[] = [];

  const brandGuard = selectBrandGuardKeywords(input.bank, input.book);
  if (brandGuard.length > 0) {
    plans.push({
      campaignType: "brand_guard",
      name: campaignName(input.book.title, "Brand Guard"),
      dailyBudget,
      targets: brandGuard.map((k) => ({
        keywordId: k.id,
        text: k.text,
        matchType: k.matchType,
        bid: k.bid ?? defaultBid,
      })),
      negatives: baseNegatives,
    });
  }

  const alphaExact = selectAlphaExactKeywords(input.bank, input.anchors);
  if (alphaExact.length > 0) {
    plans.push({
      campaignType: "alpha_exact",
      name: campaignName(input.book.title, "Alpha Exact"),
      dailyBudget,
      targets: alphaExact.map((k) => ({
        keywordId: k.id,
        text: k.text,
        matchType: k.matchType,
        bid: k.bid ?? defaultBid,
      })),
      negatives: baseNegatives,
    });
  }

  const bmmDiscovery = selectBmmDiscoveryKeywords(input.bank, alphaExact, brandGuard);
  if (bmmDiscovery.length > 0) {
    const bidByKeywordId = new Map(input.bank.map((k) => [k.id, k.bid]));
    // Safeguard (spec §3): every Alpha Exact keyword becomes a
    // campaign-level negative-exact in BMM Discovery, so the two campaigns
    // never bid against each other on the same term.
    const alphaExactNegatives: CampaignPlanNegative[] = alphaExact.map((k) => ({
      text: k.text,
      matchType: "exact",
      reason: "Alpha Exact promotion safeguard",
      scope: "campaign",
    }));
    plans.push({
      campaignType: "bmm_discovery",
      name: campaignName(input.book.title, "BMM Discovery"),
      dailyBudget,
      targets: bmmDiscovery.map((t) => ({
        keywordId: t.rootKeywordId,
        text: t.text,
        matchType: "broad",
        bid: bidByKeywordId.get(t.rootKeywordId) ?? defaultBid,
      })),
      negatives: [...baseNegatives, ...alphaExactNegatives],
    });
  }

  const rivalAsins = selectRivalAsinTargets(input.asinBank, rivalRules);
  if (rivalAsins.length > 0) {
    plans.push({
      campaignType: "rival_asin_offensive",
      name: campaignName(input.book.title, "Rival ASIN Offensive"),
      dailyBudget,
      targets: rivalAsins.map((a) => {
        const expr = `asin="${a.competitor_asin}"`;
        return { competitorAsinId: a.id, text: expr, targetingExpression: expr, bid: a.bid ?? defaultBid };
      }),
      negatives: baseNegatives,
    });
  }

  const crossSell = selectCatalogCrossSellTargets(input.siblingBooks, input.book);
  if (crossSell.length > 0) {
    plans.push({
      campaignType: "catalog_cross_sell",
      name: campaignName(input.book.title, "Catalog Cross-Sell"),
      dailyBudget,
      targets: crossSell.map((t) => {
        const expr = `asin="${t.asin}"`;
        return { text: expr, targetingExpression: expr, bid: defaultBid };
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
        return { text: expr, targetingExpression: expr, bid: defaultBid * group.bidMultiplier };
      }),
      negatives: baseNegatives,
    });
  }

  return plans;
}
