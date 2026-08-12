/**
 * Amazon Ads bulk-*upload* export (campaigns spec §1.1/§8 PR 3).
 *
 * Mirrors lib/bulksheet.ts's buildBulksheetRows structure — same campaigns,
 * same ad groups, same keyword/negative/target selection — but emits the
 * corrected upload row shape (lib/bulksheetSchema.ts's Upload* builders):
 * a Product Ad row per ad group, `Operation: "Create"`, camelCase negative
 * match types, no custom `Source` column.
 *
 * Deliberately a separate function rather than a mode flag on
 * buildBulksheetRows: the *-review.csv output (buildBulksheetRows) is the
 * existing human-readable audit trail and must not change shape, so its
 * assembly logic stays untouched here. Some duplication of the "which
 * campaigns/ad groups get created" rules is the accepted cost of that.
 */

import {
  AUTO_BUDGET_MIN,
  AUTO_BUDGET_RATIO,
  AUTO_TARGETING_GROUPS,
  campaignName,
  DEFAULT_MANUAL_DAILY_BUDGET,
  type BulksheetInput,
  type ExportKeyword,
} from "./bulksheet";
import {
  buildProductAdRow,
  buildUploadAdGroupRow,
  buildUploadCampaignNegativeKeywordRow,
  buildUploadCampaignRow,
  buildUploadKeywordRow,
  buildUploadNegativeKeywordRow,
  buildUploadProductTargetingRow,
  type UploadRow,
} from "./bulksheetSchema";
import type { NegativeKeyword } from "./negativeKeywords";

/**
 * Builds the upload row set. Requires `input.sku` (the book's own ASIN) —
 * every ad group needs a Product Ad row naming what's being advertised, and
 * there is nothing sensible to advertise without it.
 */
export function buildUploadRows(input: BulksheetInput): UploadRow[] {
  if (!input.sku) {
    throw new Error("buildUploadRows requires input.sku (the book's ASIN) for the Product Ad rows");
  }
  const sku = input.sku;

  const { bookTitle, keywords, negatives = [], productTargets = [], brandTargets = [] } = input;
  const dailyBudget = input.dailyBudget ?? DEFAULT_MANUAL_DAILY_BUDGET;
  const defaultBid = input.defaultBid ?? 0.5;
  const rows: UploadRow[] = [];

  const descriptive = keywords.filter((keyword) => keyword.group !== "comp-names");
  const compNames = keywords.filter((keyword) => keyword.group === "comp-names");

  const addCampaign = (name: string, targetingType: string) => {
    rows.push(buildUploadCampaignRow({ name, dailyBudget, targetingType }));
  };

  const addAdGroup = (campaign: string, adGroup: string, bid = defaultBid, fallbackBid?: number) => {
    rows.push(buildUploadAdGroupRow({ campaign, adGroup, bid, fallbackBid }));
    rows.push(buildProductAdRow({ campaign, adGroup, sku }));
  };

  const addKeywordRows = (campaign: string, adGroup: string, entries: ExportKeyword[]) => {
    for (const entry of entries) {
      rows.push(
        buildUploadKeywordRow({
          campaign,
          adGroup,
          text: entry.text,
          matchType: entry.matchType,
          bid: entry.bid,
          defaultBid,
          status: entry.status,
        })
      );
    }
  };

  // §1.3 — see the matching comment in lib/bulksheet.ts's addNegativeRows.
  const addNegativeRows = (campaign: string, adGroup: string, entries: NegativeKeyword[] = negatives) => {
    for (const negative of entries) {
      if ((negative.scope ?? "ad_group") === "campaign") {
        rows.push(
          buildUploadCampaignNegativeKeywordRow({
            campaign,
            text: negative.text,
            matchType: negative.matchType,
          })
        );
      } else {
        rows.push(
          buildUploadNegativeKeywordRow({
            campaign,
            adGroup,
            text: negative.text,
            matchType: negative.matchType,
          })
        );
      }
    }
  };

  if (descriptive.length > 0) {
    const campaign = campaignName(bookTitle, "Descriptive – Broad/Phrase");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "Descriptive");
    addKeywordRows(campaign, "Descriptive", descriptive);
    addNegativeRows(campaign, "Descriptive");
  }

  if (compNames.length > 0) {
    const campaign = campaignName(bookTitle, "Titles & Authors – Exact");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "Comparable titles & authors");
    addKeywordRows(campaign, "Comparable titles & authors", compNames);
    addNegativeRows(campaign, "Comparable titles & authors");
  }

  if (descriptive.length > 0 || compNames.length > 0) {
    const campaign = campaignName(bookTitle, "Auto Discovery");
    const autoBudget = Math.max(AUTO_BUDGET_MIN, Math.round(dailyBudget * AUTO_BUDGET_RATIO * 100) / 100);
    rows.push(buildUploadCampaignRow({ name: campaign, dailyBudget: autoBudget, targetingType: "auto" }));
    for (const group of AUTO_TARGETING_GROUPS) {
      addAdGroup(campaign, group.label, defaultBid * group.bidMultiplier, defaultBid);
      rows.push(
        buildUploadProductTargetingRow({
          campaign,
          adGroup: group.label,
          targetingExpression: `targetingExpression="${group.expression}"`,
          bid: defaultBid * group.bidMultiplier,
          fallbackBid: defaultBid,
        })
      );
    }
    addNegativeRows(campaign, AUTO_TARGETING_GROUPS[0].label);
  }

  if (productTargets.length > 0 || brandTargets.length > 0) {
    const campaign = campaignName(bookTitle, "Product Targeting");
    addCampaign(campaign, "manual");
    addAdGroup(campaign, "ASIN & brand targets");
    addNegativeRows(campaign, "ASIN & brand targets");

    for (const target of productTargets) {
      rows.push(
        buildUploadProductTargetingRow({
          campaign,
          adGroup: "ASIN & brand targets",
          targetingExpression: `asin="${target.asin}"`,
          bid: defaultBid,
        })
      );
    }

    for (const target of brandTargets) {
      rows.push(
        buildUploadProductTargetingRow({
          campaign,
          adGroup: "ASIN & brand targets",
          targetingExpression: `brand="${target.brand}"`,
          bid: defaultBid,
        })
      );
    }
  }

  return rows;
}
