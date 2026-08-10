-- Keyword filter pipeline: rejected status + why a keyword was rejected.
--
-- The generator now runs every candidate through an ordered filter pipeline
-- (lib/keywordFilters.ts) before anything is activated. Rejections are kept
-- rather than dropped: the admin UI shows them with the filter that stopped
-- them and its reason, so a false positive can be reviewed and resurrected,
-- and the blocklists can be tuned from real rejection counts.

-- 1. Allow the new status.
ALTER TABLE keywords DROP CONSTRAINT IF EXISTS keywords_status_check;
ALTER TABLE keywords
  ADD CONSTRAINT keywords_status_check
  CHECK (status IN ('active', 'paused', 'negative', 'archived', 'rejected'));

-- 2. Why it was rejected (or paused).
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS rejected_by_filter TEXT;

COMMENT ON COLUMN keywords.rejection_reason IS
  'Human-readable reason the filter pipeline rejected or paused this keyword.';
COMMENT ON COLUMN keywords.rejected_by_filter IS
  'Name of the filter that decided (uiPollution, offTopicEntity, anchorRelevance, …).';

-- Rejected rows are the bulk of a generate run's output; the manager filters
-- by status constantly, so make that path indexed rather than a scan.
CREATE INDEX IF NOT EXISTS idx_keywords_book_filter
  ON keywords(book_id, rejected_by_filter);

-- 3. Keep books.total_keywords meaningful: a rejected keyword is research
--    exhaust, not part of the book's keyword list.
CREATE OR REPLACE FUNCTION sync_book_keyword_count()
RETURNS TRIGGER AS $$
DECLARE
  affected_book_id UUID;
BEGIN
  affected_book_id := COALESCE(NEW.book_id, OLD.book_id);

  UPDATE books
  SET total_keywords = (
    SELECT COUNT(*) FROM keywords
    WHERE book_id = affected_book_id
      AND status NOT IN ('archived', 'rejected')
  )
  WHERE id = affected_book_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 4. Recount every book once, so counts reflect the new rule immediately
--    rather than only after the next keyword change.
UPDATE books
SET total_keywords = (
  SELECT COUNT(*) FROM keywords
  WHERE keywords.book_id = books.id
    AND keywords.status NOT IN ('archived', 'rejected')
);
