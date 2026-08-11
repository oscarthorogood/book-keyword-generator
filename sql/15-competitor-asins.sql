-- Competitor ASIN system (docs/CLAUDE-CODE-COMPETITORS.md): a reverse-ASIN
-- competitor-keyword subsystem that mirrors the shape of `keywords` /
-- `books` but is kept in its own tables so it can be filtered, exported and
-- re-generated independently of the main keyword list.
--
-- FK choice: book_id (not book_asin) — same convention as `keywords`
-- (sql/06-keywords-table.sql), which already links back to `books.id`
-- rather than duplicating the ASIN. `competitor_asin` itself is stored as
-- plain TEXT (not a FK) since it names a *competitor's* product, which this
-- app never rows for its own book.

CREATE TABLE IF NOT EXISTS competitor_asins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  competitor_asin TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'kdpradar', 'datadive', 'helium10', 'sellersprite')),
  notes TEXT,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(book_id, competitor_asin)
);

CREATE INDEX IF NOT EXISTS idx_competitor_asins_book_id ON competitor_asins(book_id);
CREATE INDEX IF NOT EXISTS idx_competitor_asins_user_id ON competitor_asins(user_id);

ALTER TABLE competitor_asins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own competitor asins" ON competitor_asins;
CREATE POLICY "Users manage own competitor asins" ON competitor_asins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_competitor_asins_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS competitor_asins_update_timestamp ON competitor_asins;
CREATE TRIGGER competitor_asins_update_timestamp
  BEFORE UPDATE ON competitor_asins
  FOR EACH ROW
  EXECUTE FUNCTION update_competitor_asins_updated_at();

-- Competitor-derived keyword candidates (reverse-ASIN imports, aggregated
-- across one or more competitor ASINs — see lib/reverseAsin.ts). Mirrors the
-- fields on KeywordCandidate (lib/types.ts) so the filter pipeline and
-- cap-and-rank can treat these like ordinary keywords; kept in a separate
-- table (rather than in `keywords`) per the spec, so competitor data never
-- mixes into the book's own active keyword list until a human promotes it.
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
