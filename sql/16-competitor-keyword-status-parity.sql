-- Competitor-keyword status parity with `keywords` (sql/08, sql/09): the
-- Competitors tab is meant to be "handled the exact same way as keywords,
-- just as ASINs instead of keywords" — same status workflow (active/paused/
-- negative/archived/rejected), same filter-verdict trail, same per-row bid.

-- 1. Allow the same status set as `keywords`.
ALTER TABLE competitor_keywords DROP CONSTRAINT IF EXISTS competitor_keywords_status_check;
ALTER TABLE competitor_keywords
  ADD CONSTRAINT competitor_keywords_status_check
  CHECK (status IN ('active', 'paused', 'negative', 'archived', 'rejected'));

-- 2. Why the re-run-filters pass rejected or paused a row (mirrors
--    keywords.rejection_reason / keywords.rejected_by_filter).
ALTER TABLE competitor_keywords ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE competitor_keywords ADD COLUMN IF NOT EXISTS rejected_by_filter TEXT;

COMMENT ON COLUMN competitor_keywords.rejection_reason IS
  'Human-readable reason the filter pipeline rejected or paused this competitor keyword.';
COMMENT ON COLUMN competitor_keywords.rejected_by_filter IS
  'Name of the filter that decided (uiPollution, offTopicEntity, anchorRelevance, …).';

CREATE INDEX IF NOT EXISTS idx_competitor_keywords_book_filter
  ON competitor_keywords(book_id, rejected_by_filter);

-- 3. Per-row ad bid, same as keywords.bid — needed for the bulksheet export
--    action card and inline bid editing in the manager table.
ALTER TABLE competitor_keywords ADD COLUMN IF NOT EXISTS bid NUMERIC(10, 2);

COMMENT ON COLUMN competitor_keywords.bid IS
  'Per-keyword ad bid, same meaning as keywords.bid. Null uses the export default bid.';
