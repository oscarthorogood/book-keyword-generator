/**
 * Renders lib/campaignBulksheetPlan.ts's CampaignPlan[] into bulksheet rows
 * for the 5-campaign structure (campaigns spec §4) — the review-CSV shape
 * (lib/bulksheetSchema.ts's original builders) and the upload-xlsx shape
 * (the Upload* builders from PR 3). Both walk the same plan structure:
 * one Campaign row, then one Ad Group (+ Product Ad, upload only) per
 * distinct ad group in the plan's targets, then a Keyword or Product
 * Targeting row per target, then negatives — ad_group-scoped negatives
 * attach only to the first ad group (matching the existing multi-ad-group
 * convention in lib/bulksheet.ts's Auto Discovery), campaign-scoped
 * negatives attach once per campaign with no ad group at all.
 */

import {
  buildAdGroupRow,
  buildCampaignNegativeKeywordRow,
  buildCampaignRow,
  buildKeywordRow,
  buildNegativeKeywordRow,
  buildProductAdRow,
  buildProductTargetingRow,
  buildUploadAdGroupRow,
  buildUploadCampaignNegativeKeywordRow,
  buildUploadCampaignRow,
  buildUploadKeywordRow,
  buildUploadNegativeKeywordRow,
  buildUploadProductTargetingRow,
  type BulksheetRow,
  type UploadRow,
} from "./bulksheetSchema";
import type { CampaignPlan, CampaignPlanTarget } from "./campaignBulksheetPlan";
import type { DiffedCampaignTarget } from "./campaignDiff";

function adGroupsInOrder(targets: CampaignPlanTarget[]): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const target of targets) {
    if (!seen.has(target.adGroup)) {
      seen.add(target.adGroup);
      order.push(target.adGroup);
    }
  }
  return order;
}

export function buildCampaignReviewRows(plans: CampaignPlan[]): BulksheetRow[] {
  const rows: BulksheetRow[] = [];

  for (const plan of plans) {
    rows.push(buildCampaignRow({ name: plan.name, dailyBudget: plan.dailyBudget, targetingType: "manual" }));

    const adGroups = adGroupsInOrder(plan.targets);
    const adGroupNegatives = plan.negatives.filter((n) => n.scope === "ad_group");

    adGroups.forEach((adGroup, index) => {
      const targetsInGroup = plan.targets.filter((t) => t.adGroup === adGroup);
      rows.push(buildAdGroupRow({ campaign: plan.name, adGroup, bid: targetsInGroup[0]?.bid ?? 0.5 }));

      for (const target of targetsInGroup) {
        if (target.matchType) {
          rows.push(
            buildKeywordRow({
              campaign: plan.name,
              adGroup,
              text: target.text,
              matchType: target.matchType,
              bid: target.bid,
              defaultBid: target.bid ?? 0.5,
            })
          );
        } else {
          rows.push(
            buildProductTargetingRow({
              campaign: plan.name,
              adGroup,
              targetingExpression: target.targetingExpression ?? target.text,
              bid: target.bid ?? 0.5,
            })
          );
        }
      }

      if (index === 0) {
        for (const negative of adGroupNegatives) {
          rows.push(buildNegativeKeywordRow({ campaign: plan.name, adGroup, text: negative.text, matchType: negative.matchType, reason: negative.reason }));
        }
      }
    });

    for (const negative of plan.negatives.filter((n) => n.scope === "campaign")) {
      rows.push(buildCampaignNegativeKeywordRow({ campaign: plan.name, text: negative.text, matchType: negative.matchType, reason: negative.reason }));
    }
  }

  return rows;
}

export function buildCampaignUploadRows(plans: CampaignPlan[], sku: string): UploadRow[] {
  const rows: UploadRow[] = [];

  for (const plan of plans) {
    rows.push(buildUploadCampaignRow({ name: plan.name, dailyBudget: plan.dailyBudget, targetingType: "manual" }));

    const adGroups = adGroupsInOrder(plan.targets);
    const adGroupNegatives = plan.negatives.filter((n) => n.scope === "ad_group");

    adGroups.forEach((adGroup, index) => {
      const targetsInGroup = plan.targets.filter((t) => t.adGroup === adGroup);
      rows.push(buildUploadAdGroupRow({ campaign: plan.name, adGroup, bid: targetsInGroup[0]?.bid ?? 0.5 }));
      rows.push(buildProductAdRow({ campaign: plan.name, adGroup, sku }));

      for (const target of targetsInGroup) {
        if (target.matchType) {
          rows.push(
            buildUploadKeywordRow({
              campaign: plan.name,
              adGroup,
              text: target.text,
              matchType: target.matchType,
              bid: target.bid,
              defaultBid: target.bid ?? 0.5,
            })
          );
        } else {
          rows.push(
            buildUploadProductTargetingRow({
              campaign: plan.name,
              adGroup,
              targetingExpression: target.targetingExpression ?? target.text,
              bid: target.bid ?? 0.5,
            })
          );
        }
      }

      if (index === 0) {
        for (const negative of adGroupNegatives) {
          rows.push(buildUploadNegativeKeywordRow({ campaign: plan.name, adGroup, text: negative.text, matchType: negative.matchType }));
        }
      }
    });

    for (const negative of plan.negatives.filter((n) => n.scope === "campaign")) {
      rows.push(buildUploadCampaignNegativeKeywordRow({ campaign: plan.name, text: negative.text, matchType: negative.matchType }));
    }
  }

  return rows;
}

// --- Update Campaign (spec §4) — one row per diffed target, no campaign/ad
// group/negative structure re-created, since those already exist in Amazon.
// Reuses the same entity-row builders as Create, extended with an
// `operation` parameter (spec: "extend the existing bulksheet builder ...
// don't fork a second builder") rather than a parallel set of row builders.

export function buildUpdateReviewRows(campaign: string, adGroup: string, diffed: DiffedCampaignTarget[]): BulksheetRow[] {
  return diffed.map((target) => {
    const operation = target.operation === "Create" ? "create" : target.operation;
    if (target.matchType) {
      return buildKeywordRow({
        campaign,
        adGroup,
        text: target.text,
        matchType: target.matchType,
        bid: target.bid,
        defaultBid: target.bid ?? 0.5,
        status: target.state,
        operation,
      });
    }
    return buildProductTargetingRow({
      campaign,
      adGroup,
      targetingExpression: target.targetingExpression ?? target.text,
      bid: target.bid ?? 0.5,
      operation,
    });
  });
}

export function buildUpdateUploadRows(campaign: string, adGroup: string, diffed: DiffedCampaignTarget[]): UploadRow[] {
  return diffed.map((target) => {
    if (target.matchType) {
      return buildUploadKeywordRow({
        campaign,
        adGroup,
        text: target.text,
        matchType: target.matchType,
        bid: target.bid,
        defaultBid: target.bid ?? 0.5,
        status: target.state,
        operation: target.operation,
      });
    }
    return buildUploadProductTargetingRow({
      campaign,
      adGroup,
      targetingExpression: target.targetingExpression ?? target.text,
      bid: target.bid ?? 0.5,
      operation: target.operation,
    });
  });
}
