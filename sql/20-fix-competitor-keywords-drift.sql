-- Corrective migration (Prerequisite C, campaigns spec §3 / §0 V3-V4).
--
-- docs/CAMPAIGNS-PREFLIGHT.md found two live/committed drifts, both
-- pre-dating the campaigns work and both already breaking live features:
--
-- 1. sql/15-competitor-asins.sql commits a `competitor_keywords` table
--    (used by lib/competitorStore.ts, lib/reverseAsin.ts,
--    lib/keywordCapAndRank.ts, lib/types.ts, and the reverse-ASIN import
--    route), but the live DB never got it — the migration named
--    "15_competitor_asins" applied only the `competitor_asins` half.
--    Re-creates it verbatim from sql/15 (idempotent: IF NOT EXISTS).
--
-- 2. sql/19-competitor-asin-source-live-sources.sql was never applied
--    live at all: the live competitor_asins_source_check constraint is
--    still the sql/18 value set, missing every live-discovery source
--    (amazon-autocomplete, serpapi, zenrows, etc.) that
--    app/api/books/[id]/competitors/generate/route.ts actually writes.
--    Re-applied verbatim (already idempotent: DROP CONSTRAINT IF EXISTS).
--
-- This migration ships alone, ahead of the campaigns schema (sql/21+),
-- so a bad rollback on the campaigns work can't take this fix with it.

BEGIN;

-- --- 1. competitor_keywords (verbatim from sql/15-competitor-asins.sql) ---

CREATE TABLE IF NOT EXISTS competitor_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- The single competitor ASIN this row's rank/volume came from. When a term
  -- appears for more than one competitor ASIN, aggregateReverseAsinRows
  -- collapses those rows into one entry (competitor_count > 1) attributed to
  -- the strongest-ranking ASIN, rather than duplicating a row per ASIN.
  competitor_asin TEXT NOT NULL,

  text TEXT NOT NULL,
  volume INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  competitor_count INTEGER NOT NULL DEFAULT 1,
  mean_rank NUMERIC(10, 2),

  category TEXT,
  intent_segment TEXT,
  match_type TEXT NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('broad', 'phrase', 'exact')),
  specificity SMALLINT CHECK (specificity BETWEEN 1 AND 5),

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(book_id, text, competitor_asin)
);

CREATE INDEX IF NOT EXISTS idx_competitor_keywords_book_id ON competitor_keywords(book_id);
CREATE INDEX IF NOT EXISTS idx_competitor_keywords_user_id ON competitor_keywords(user_id);
CREATE INDEX IF NOT EXISTS idx_competitor_keywords_book_category ON competitor_keywords(book_id, category);

ALTER TABLE competitor_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own competitor keywords" ON competitor_keywords;
CREATE POLICY "Users manage own competitor keywords" ON competitor_keywords
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_competitor_keywords_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS competitor_keywords_update_timestamp ON competitor_keywords;
CREATE TRIGGER competitor_keywords_update_timestamp
  BEFORE UPDATE ON competitor_keywords
  FOR EACH ROW
  EXECUTE FUNCTION update_competitor_keywords_updated_at();

-- --- 2. competitor_asins_source_check (verbatim from sql/19) ---

ALTER TABLE competitor_asins DROP CONSTRAINT IF EXISTS competitor_asins_source_check;
ALTER TABLE competitor_asins
  ADD CONSTRAINT competitor_asins_source_check
  CHECK (source IN (
    'manual', 'kdpradar', 'datadive', 'helium10', 'sellersprite',
    'auto-crawl', 'genre-preset',
    'amazon-autocomplete', 'google-autocomplete', 'youtube-autocomplete', 'duckduckgo-autocomplete',
    'serpapi', 'ads-api', 'persona-llm', 'groq-persona', 'decodo', 'zenrows'
  ));

COMMIT;
