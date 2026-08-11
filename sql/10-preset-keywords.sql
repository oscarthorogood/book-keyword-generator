-- Preset keywords by genre (Enhancements spec §3): a managed library of
-- preset keywords per genre -> sub-genre. Applying matching presets to a
-- book inserts keywords tagged source='genre-preset' with a
-- preset_keyword_id back-reference; editing a preset propagates to every
-- book still carrying that reference (nulled out on manual edit, see the
-- keywords.preset_keyword_id column below, so propagation never clobbers a
-- user's own edit).
--
-- This is ARCHITECTURE.md's "template library split" (Phase 2.3) — these
-- are that feature, not a parallel table set.

CREATE TABLE IF NOT EXISTS preset_genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  parent_id UUID REFERENCES preset_genres(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, parent_id, name)
);

CREATE TABLE IF NOT EXISTS preset_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES preset_genres(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('broad', 'phrase', 'exact')),
  specificity SMALLINT CHECK (specificity BETWEEN 1 AND 5),
  -- Tier A applies automatically on "Apply genre presets"; Tier B is
  -- inserted paused for manual review regardless of filter verdict.
  tier TEXT NOT NULL DEFAULT 'a' CHECK (tier IN ('a', 'b')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(genre_id, keyword, match_type)
);

-- Subscription record: which books have applied which genre's presets, so
-- future edits to that genre's keyword list know which books to propagate to.
CREATE TABLE IF NOT EXISTS book_preset_genres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  genre_id UUID NOT NULL REFERENCES preset_genres(id) ON DELETE CASCADE,
  applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(book_id, genre_id)
);

-- Applied copies land in keywords with source='genre-preset' and this
-- back-reference. SET NULL on preset deletion (not CASCADE) — the applied
-- keyword stays on the book as a normal manual keyword rather than
-- disappearing when someone edits the library.
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS preset_keyword_id UUID REFERENCES preset_keywords(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_preset_genres_user_id ON preset_genres(user_id);
CREATE INDEX IF NOT EXISTS idx_preset_genres_parent_id ON preset_genres(parent_id);
CREATE INDEX IF NOT EXISTS idx_preset_keywords_genre_id ON preset_keywords(genre_id);
CREATE INDEX IF NOT EXISTS idx_book_preset_genres_book_id ON book_preset_genres(book_id);
CREATE INDEX IF NOT EXISTS idx_book_preset_genres_genre_id ON book_preset_genres(genre_id);
CREATE INDEX IF NOT EXISTS idx_keywords_preset_keyword_id ON keywords(preset_keyword_id);

ALTER TABLE preset_genres ENABLE ROW LEVEL SECURITY;
ALTER TABLE preset_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE book_preset_genres ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own preset genres" ON preset_genres;
CREATE POLICY "Users manage own preset genres" ON preset_genres
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own preset keywords" ON preset_keywords;
CREATE POLICY "Users manage own preset keywords" ON preset_keywords
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own book preset subscriptions" ON book_preset_genres;
CREATE POLICY "Users manage own book preset subscriptions" ON book_preset_genres
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_preset_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS preset_genres_update_timestamp ON preset_genres;
CREATE TRIGGER preset_genres_update_timestamp
  BEFORE UPDATE ON preset_genres
  FOR EACH ROW
  EXECUTE FUNCTION update_preset_updated_at();

DROP TRIGGER IF EXISTS preset_keywords_update_timestamp ON preset_keywords;
CREATE TRIGGER preset_keywords_update_timestamp
  BEFORE UPDATE ON preset_keywords
  FOR EACH ROW
  EXECUTE FUNCTION update_preset_updated_at();
