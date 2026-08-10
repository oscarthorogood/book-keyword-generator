/**
 * ASIN and ISBN validation to prevent invalid product-targeting expressions
 * from being shipped to Amazon Ads, which will either silently drop or error
 * on import (§2.2 from audit).
 */

/**
 * Validate ASIN format: must be "B0" + 8 alphanumeric characters
 * OR a valid ISBN (10 digits with optional X at end, or 13 digits).
 */
export function isValidAsinOrIsbn(value: string): boolean {
  if (!value || typeof value !== "string") return false;

  const trimmed = value.trim().toUpperCase();

  // B0 + 8 alphanumeric characters (standard ASIN format)
  if (/^B0[A-Z0-9]{8}$/.test(trimmed)) {
    return true;
  }

  // ISBN-10: 9 digits + optional X at end
  if (/^\d{9}[\dX]$/.test(trimmed)) {
    return true;
  }

  // ISBN-13: 13 digits
  if (/^\d{13}$/.test(trimmed)) {
    return true;
  }

  return false;
}

/**
 * Placeholder/fallback strings that shouldn't reach output (§2.2).
 * Examples: "CLOVERLEAF", "UNKNOWN", "N/A", "TBD".
 * These look like the scraper hit a missing data field and left a placeholder.
 */
const PLACEHOLDER_STRINGS = new Set([
  "CLOVERLEAF",
  "UNKNOWN",
  "N/A",
  "NA",
  "TBD",
  "NULL",
  "NONE",
  "PLACEHOLDER",
  "TODO",
  "UNSET",
  "ERROR",
  "FAILED",
]);

/**
 * Check if a string looks like a placeholder/fallback rather than a real ASIN.
 * These shouldn't ever ship to the bulksheet.
 */
export function looksLikePlaceholder(value: string): boolean {
  if (!value) return true;
  return PLACEHOLDER_STRINGS.has(value.trim().toUpperCase());
}

/**
 * Validate an ASIN, rejecting both invalid formats and placeholder strings.
 * Returns true only if the value is a legitimate ASIN/ISBN and not a fallback.
 */
export function isValidProductAsin(value: string): boolean {
  if (looksLikePlaceholder(value)) {
    return false;
  }
  return isValidAsinOrIsbn(value);
}
