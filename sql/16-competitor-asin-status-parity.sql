-- Competitor-ASIN status parity with `keywords` (sql/08, sql/09): the
-- Competitors tab manages ASINs the exact same way the Keywords tab manages
-- keywords — same status workflow (active/paused/negative/archived/
-- rejected), same filter-verdict trail, same per-row bid. Competitor
-- keywords (competitor_keywords / sql/15) are not part of this — the
-- Competitors page is ASIN-only.

-- 1. Same status set as `keywords`.
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE competitor_asins DROP CONSTRAINT IF EXISTS competitor_asins_status_check;
ALTER TABLE competitor_asins
  ADD CONSTRAINT competitor_asins_status_check
  CHECK (status IN ('active', 'paused', 'negative', 'archived', 'rejected'));

-- 2. Why the re-run-filters pass rejected or paused a row.
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS rejected_by_filter TEXT;

COMMENT ON COLUMN competitor_asins.rejection_reason IS
  'Human-readable reason the filter pipeline rejected or paused this competitor ASIN.';
COMMENT ON COLUMN competitor_asins.rejected_by_filter IS
  'Name of the filter that decided (asinFormat, selfAsin, …).';

CREATE INDEX IF NOT EXISTS idx_competitor_asins_book_status ON competitor_asins(book_id, status);

-- 3. Per-row ad bid for the ASIN's product-targeting export.
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS bid NUMERIC(10, 2);

COMMENT ON COLUMN competitor_asins.bid IS
  'Per-ASIN product-targeting bid. Null uses the export default bid.';

-- 4. "Generate ASINs" pulls from the competitor crawl already captured when
--    the book's metadata was fetched (same anchors as keyword generation),
--    so it needs its own source tag alongside the manual-import tools.
ALTER TABLE competitor_asins DROP CONSTRAINT IF EXISTS competitor_asins_source_check;
ALTER TABLE competitor_asins
  ADD CONSTRAINT competitor_asins_source_check
  CHECK (source IN ('manual', 'kdpradar', 'datadive', 'helium10', 'sellersprite', 'auto-crawl'));
