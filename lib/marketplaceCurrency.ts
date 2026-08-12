import type { Marketplace } from "./types";

/**
 * Decision 3 (docs/CAMPAIGNS-PROGRESS.md): currency is per-book, derived
 * from the book's own marketplace rather than a fixed schema default —
 * campaigns.currency and campaign_results.currency (sql/21, sql/23) are
 * NOT NULL with no DEFAULT, so every write must go through this.
 */
const MARKETPLACE_CURRENCY: Record<Marketplace, string> = {
  US: "USD",
  UK: "GBP",
  CA: "CAD",
  DE: "EUR",
  FR: "EUR",
  IT: "EUR",
  ES: "EUR",
};

export function marketplaceCurrency(marketplace: Marketplace): string {
  return MARKETPLACE_CURRENCY[marketplace];
}
