/**
 * ID generation utilities for campaigns, ad groups, keywords, and product targeting.
 * Generates unique, deterministic IDs that can be stored and referenced.
 */

/**
 * Generates a unique campaign ID based on timestamp and random suffix.
 * Format: CAMP_YYYYMMDD_XXXXX (14 characters)
 * Example: CAMP_20260810_a1b2c
 */
export function generateCampaignId(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const randomSuffix = generateRandomSuffix(5);

  return `CAMP_${year}${month}${day}_${randomSuffix}`;
}

/**
 * Generates a unique ad group ID based on campaign ID and suffix.
 * Format: AG_CAMP_{campaignId}_{index} (prefixed with campaign ID)
 * Example: AG_CAMP_20260810_a1b2c_001
 */
export function generateAdGroupId(campaignId: string, index: number): string {
  const paddedIndex = String(index).padStart(3, "0");
  return `AG_${campaignId}_${paddedIndex}`;
}

/**
 * Generates a unique keyword ID based on campaign and ad group.
 * Format: KW_CAMP_{campaignId}_{adGroupIndex}_{keywordIndex}
 * Example: KW_CAMP_20260810_a1b2c_001_0042
 */
export function generateKeywordId(
  campaignId: string,
  adGroupIndex: number,
  keywordIndex: number
): string {
  const paddedAgIndex = String(adGroupIndex).padStart(3, "0");
  const paddedKwIndex = String(keywordIndex).padStart(4, "0");
  return `KW_${campaignId}_${paddedAgIndex}_${paddedKwIndex}`;
}

/**
 * Generates a unique product targeting ID.
 * Format: PT_CAMP_{campaignId}_{adGroupIndex}_{targetIndex}
 * Example: PT_CAMP_20260810_a1b2c_001_0015
 */
export function generateProductTargetId(
  campaignId: string,
  adGroupIndex: number,
  targetIndex: number
): string {
  const paddedAgIndex = String(adGroupIndex).padStart(3, "0");
  const paddedTargetIndex = String(targetIndex).padStart(4, "0");
  return `PT_${campaignId}_${paddedAgIndex}_${paddedTargetIndex}`;
}

/**
 * Generates a random alphanumeric suffix for uniqueness.
 * Uses lowercase letters and numbers for compact representation.
 */
function generateRandomSuffix(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generates a complete ID set for a campaign with all entities.
 * Useful for pre-allocating IDs before building the bulksheet.
 */
export function generateCampaignIdSet(
  adGroupCount: number,
  keywordCounts: number[],
  productTargetCounts: number[]
) {
  const campaignId = generateCampaignId();

  return {
    campaignId,
    adGroupIds: Array.from({ length: adGroupCount }, (_, i) =>
      generateAdGroupId(campaignId, i)
    ),
    generateKeywordId: (adGroupIndex: number, keywordIndex: number) =>
      generateKeywordId(campaignId, adGroupIndex, keywordIndex),
    generateProductTargetId: (adGroupIndex: number, targetIndex: number) =>
      generateProductTargetId(campaignId, adGroupIndex, targetIndex),
  };
}

/**
 * Converts a campaign name to a slug for file naming.
 * Removes special characters and converts to lowercase with hyphens.
 */
export function campaignNameToSlug(campaignName: string): string {
  return campaignName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Generates a filename for export bulksheets.
 * Format: bulksheet_{campaignSlug}_{timestamp}.xlsx
 */
export function generateBulksheetFilename(campaignName: string): string {
  const slug = campaignNameToSlug(campaignName);
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `bulksheet_${slug}_${timestamp}.xlsx`;
}
