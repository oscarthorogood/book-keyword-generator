-- Keyword Manager: first-class keywords table, scoped to a book
-- Replaces the old model of keywords existing only inside campaigns.keywords_json

CREATE TABLE IF NOT EXISTS keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  text TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'phrase' CHECK (match_type IN ('broad', 'phrase', 'exact')),
  category TEXT,
  source TEXT,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'negative', 'archived')),
  bid DECIMAL(10, 2),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(book_id, text, match_type)
);

CREATE INDEX IF NOT EXISTS idx_keywords_book_id
  ON keywords(book_id);

CREATE INDEX IF NOT EXISTS idx_keywords_user_id
  ON keywords(user_id);

CREATE INDEX IF NOT EXISTS idx_keywords_book_status
  ON keywords(book_id, status);

ALTER TABLE keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own keywords" ON keywords;
CREATE POLICY "Users read own keywords" ON keywords
  FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own keywords" ON keywords;
CREATE POLICY "Users insert own keywords" ON keywords
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own keywords" ON keywords;
CREATE POLICY "Users update own keywords" ON keywords
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own keywords" ON keywords;
CREATE POLICY "Users delete own keywords" ON keywords
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_keywords_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS keywords_update_timestamp ON keywords;
CREATE TRIGGER keywords_update_timestamp
  BEFORE UPDATE ON keywords
  FOR EACH ROW
  EXECUTE FUNCTION update_keywords_updated_at();

-- Keep books.total_keywords in sync with the keywords table (non-archived count)
CREATE OR REPLACE FUNCTION sync_book_keyword_count()
RETURNS TRIGGER AS $$
DECLARE
  affected_book_id UUID;
BEGIN
  affected_book_id := COALESCE(NEW.book_id, OLD.book_id);

  UPDATE books
  SET total_keywords = (
    SELECT COUNT(*) FROM keywords
    WHERE book_id = affected_book_id AND status != 'archived'
  )
  WHERE id = affected_book_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS keywords_sync_book_count ON keywords;
CREATE TRIGGER keywords_sync_book_count
  AFTER INSERT OR UPDATE OR DELETE ON keywords
  FOR EACH ROW
  EXECUTE FUNCTION sync_book_keyword_count();
