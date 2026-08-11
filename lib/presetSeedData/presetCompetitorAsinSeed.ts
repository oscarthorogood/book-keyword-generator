/**
 * Starter seed for the preset competitor-ASIN library (competitor-ASIN
 * enhancements task 4).
 *
 * Unlike lib/presetSeedData/vinciKeywordBank.ts's keyword bank, there is no
 * vetted source of real competitor ASINs to check in here — an invented
 * ASIN would point a real ad campaign's product targeting at a product that
 * doesn't exist (or the wrong one), which spends the user's real ad budget
 * on nothing. This file is intentionally empty rather than filled with
 * placeholder ASINs.
 *
 * Populate it (via a real ASIN research pass per genre) or add rows
 * directly from the Presets UI's competitor-ASIN tab
 * (components/PresetsPage.tsx) — both land in the same
 * `preset_competitor_asins` table (sql/18-preset-competitor-asins.sql).
 */

export interface PresetCompetitorAsinSeedRow {
  genreName: string;
  competitorAsin: string;
  notes?: string;
}

export const PRESET_COMPETITOR_ASIN_SEED: PresetCompetitorAsinSeedRow[] = [];
