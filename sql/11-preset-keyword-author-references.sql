-- Preserves the comp-author context that came with the imported starter
-- keyword library (lib/presetSeedData/vinciKeywordBank.ts) — which authors
-- each preset keyword was researched against. Optional; user-added preset
-- keywords can leave it null.

ALTER TABLE preset_keywords ADD COLUMN IF NOT EXISTS author_references TEXT[];

COMMENT ON COLUMN preset_keywords.author_references IS
  'Comparable authors this preset keyword was researched against, if known (e.g. from an imported starter library).';
