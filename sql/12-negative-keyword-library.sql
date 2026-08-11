-- Shared negative-keyword library (Enhancements spec §15): negatives
-- scoped global / per-genre / per-book, merged into the bulksheet export
-- alongside the per-book negatives the generate route already writes to
-- `keywords`. A per-book rejection can be "promoted" here so the same
-- off-topic term doesn't have to be rediscovered — and re-negated — on
-- every other book in the same genre.

CREATE TABLE IF NOT EXISTS negative_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('phrase', 'exact')),
  scope TEXT NOT NULL CHECK (scope IN ('global', 'genre', 'book')),
  genre_id UUID REFERENCES preset_genres(id) ON DELETE CASCADE,
  book_id UUID REFERENCES books(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('starter', 'manual', 'promoted-from-rejection', 'search-term-report')),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  -- Exactly one scoping column set per scope, so a genre-scoped row can't
  -- accidentally also carry a book_id (or vice versa).
  CHECK (
    (scope = 'global' AND genre_id IS NULL AND book_id IS NULL) OR
    (scope = 'genre' AND genre_id IS NOT NULL AND book_id IS NULL) OR
    (scope = 'book' AND book_id IS NOT NULL AND genre_id IS NULL)
  ),
  UNIQUE(user_id, scope, genre_id, book_id, keyword, match_type)
);

CREATE INDEX IF NOT EXISTS idx_negative_keywords_user_id ON negative_keywords(user_id);
CREATE INDEX IF NOT EXISTS idx_negative_keywords_genre_id ON negative_keywords(genre_id);
CREATE INDEX IF NOT EXISTS idx_negative_keywords_book_id ON negative_keywords(book_id);

ALTER TABLE negative_keywords ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users manage own negative keywords" ON negative_keywords
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
