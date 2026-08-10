-- Book-Centric System: Books Table
-- Primary entity for organizing all ad campaigns and keyword research

CREATE TABLE IF NOT EXISTS books (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Book Identifiers
  asin TEXT NOT NULL,
  marketplace TEXT NOT NULL DEFAULT 'US',

  -- Book Metadata (fetched from Amazon)
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  description TEXT,

  -- Metadata JSON (comprehensive book info)
  metadata_json JSONB, -- Stores cover image, categories, rating, price, etc.

  -- Summary Statistics
  campaign_count INTEGER DEFAULT 0,
  total_keywords INTEGER DEFAULT 0,
  total_spend DECIMAL(10, 2) DEFAULT 0,

  -- Audit Trail
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint: one book per ASIN per marketplace per user
  UNIQUE(user_id, asin, marketplace)
);

-- ============================================================================
-- Add book_id to campaigns table (if not exists)
-- ============================================================================

ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS book_id UUID REFERENCES books(id) ON DELETE CASCADE;

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_books_user_id
  ON books(user_id);

CREATE INDEX IF NOT EXISTS idx_books_asin
  ON books(asin);

CREATE INDEX IF NOT EXISTS idx_books_user_created
  ON books(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_book_id
  ON campaigns(book_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE books ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view only their own books
CREATE POLICY IF NOT EXISTS "Users read own books" ON books
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can create books
CREATE POLICY IF NOT EXISTS "Users create books" ON books
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own books
CREATE POLICY IF NOT EXISTS "Users update own books" ON books
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- TRIGGER: Update updated_at timestamp on changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_books_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER IF NOT EXISTS books_update_timestamp
  BEFORE UPDATE ON books
  FOR EACH ROW
  EXECUTE FUNCTION update_books_updated_at();

-- ============================================================================
-- HELPER FUNCTION: Get user's books with campaign counts
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_books_summary(user_uuid UUID)
RETURNS TABLE (
  id UUID,
  asin TEXT,
  title TEXT,
  author TEXT,
  marketplace TEXT,
  campaign_count INTEGER,
  total_keywords INTEGER,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
SELECT
  b.id,
  b.asin,
  b.title,
  b.author,
  b.marketplace,
  COALESCE(COUNT(c.id), 0)::INTEGER as campaign_count,
  COALESCE(SUM(c.total_rows), 0)::INTEGER as total_keywords,
  b.created_at
FROM books b
LEFT JOIN campaigns c ON b.id = c.book_id
WHERE b.user_id = user_uuid
GROUP BY b.id
ORDER BY b.created_at DESC;
$$ LANGUAGE sql STABLE;
