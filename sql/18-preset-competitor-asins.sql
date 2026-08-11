-- Preset competitor ASINs by genre/sub-genre (competitor-ASIN enhancements
-- task 4): a managed library of preset competitor ASINs per genre ->
-- sub-genre, reusing the same preset_genres hierarchy the keyword library
-- (sql/10-preset-keywords.sql) already built rather than a parallel tree.
--
-- Applying matching presets to a book inserts rows into competitor_asins
-- tagged source='genre-preset' with a preset_competitor_asin_id
-- back-reference; editing a preset propagates to every book still carrying
-- that reference (nulled out on manual edit — see the competitor_asins.
-- preset_competitor_asin_id column below — so propagation never clobbers a
-- user's own edit), mirroring keywords.preset_keyword_id exactly.

CREATE TABLE IF NOT EXISTS preset_competitor_asins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES preset_genres(id) ON DELETE CASCADE,
  competitor_asin TEXT NOT NULL,
  notes TEXT,
  -- Tier A applies automatically on "Apply genre presets"; Tier B is
  -- inserted paused for manual review regardless of the re-run-filters verdict.
  tier TEXT NOT NULL DEFAULT 'a' CHECK (tier IN ('a', 'b')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(genre_id, competitor_asin)
);

-- Subscription record: which books have applied which genre's preset
-- competitor ASINs, so future edits to that genre's list know which books
-- to propagate to. Separate from book_preset_genres (sql/10) since a book
-- can apply a genre's keyword presets without applying its competitor-ASIN
-- presets, or vice versa.
CREATE TABLE IF NOT EXISTS book_preset_competitor_asin_genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES preset_genres(id) ON DELETE CASCADE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(book_id, genre_id)
);

-- Applied copies land in competitor_asins with source='genre-preset' and
-- this back-reference. SET NULL on preset deletion (not CASCADE) — the
-- applied row stays on the book as a normal manually-tracked competitor ASIN
-- rather than disappearing when someone edits the library.
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS preset_competitor_asin_id UUID REFERENCES preset_competitor_asins(id) ON DELETE SET NULL;

-- "Apply genre presets" needs its own source tag alongside the existing
-- manual-import/auto-crawl sources (sql/16-competitor-asin-status-parity.sql).
ALTER TABLE competitor_asins DROP CONSTRAINT IF EXISTS competitor_asins_source_check;
ALTER TABLE competitor_asins
  ADD CONSTRAINT competitor_asins_source_check
  CHECK (source IN ('manual', 'kdpradar', 'datadive', 'helium10', 'sellersprite', 'auto-crawl', 'genre-preset'));

CREATE INDEX IF NOT EXISTS idx_preset_competitor_asins_genre_id ON preset_competitor_asins(genre_id);
CREATE INDEX IF NOT EXISTS idx_book_preset_competitor_asin_genres_book_id ON book_preset_competitor_asin_genres(book_id);
CREATE INDEX IF NOT EXISTS idx_book_preset_competitor_asin_genres_genre_id ON book_preset_competitor_asin_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_competitor_asins_preset_competitor_asin_id ON competitor_asins(preset_competitor_asin_id);

ALTER TABLE preset_competitor_asins ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_preset_competitor_asin_genres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own preset competitor asins" ON preset_competitor_asins;
CREATE POLICY "Users manage own preset competitor asins" ON preset_competitor_asins
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own book preset competitor asin subscriptions" ON book_preset_competitor_asin_genres;
CREATE POLICY "Users manage own book preset competitor asin subscriptions" ON book_preset_competitor_asin_genres
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Reuses update_preset_updated_at() defined in sql/10-preset-keywords.sql.
DROP TRIGGER IF EXISTS preset_competitor_asins_update_timestamp ON preset_competitor_asins;
CREATE TRIGGER preset_competitor_asins_update_timestamp
  BEFORE UPDATE ON preset_competitor_asins
  FOR EACH ROW
  EXECUTE FUNCTION update_preset_updated_at();
