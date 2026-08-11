-- Minimal competitor-ASIN metadata (competitor-ASIN enhancements task 1):
-- the "Generate ASINs" flow (app/api/books/[id]/competitors/generate/route.ts)
-- now fetches a light product snapshot for each newly discovered ASIN via
-- lib/scrape.ts's scrapeProductPage (reused, not duplicated) and records how
-- consistently that ASIN turned up across the crawl/live discovery sources.
--
-- All columns are additive and nullable — existing rows (and the manual /
-- import sources that don't have this data) are unaffected.

ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS author TEXT;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS price NUMERIC(10, 2);
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS bsr INTEGER;

-- Number of distinct discovery sources/lists (snapshot competitors, "also
-- bought", live autocomplete/SerpApi/etc.) that surfaced this ASIN during a
-- single "Generate ASINs" run. Mirrors competitor_keywords.competitor_count
-- (sql/15-competitor-asins.sql), but counts source agreement on the ASIN
-- itself rather than distinct competitor ASINs a keyword ranks for.
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS competitor_count INTEGER;

-- Average 1-based position of this ASIN within the discovery lists it
-- appeared in (lower = surfaced earlier/more prominently, on average).
-- Mirrors competitor_keywords.mean_rank in spirit; null until generation has
-- recorded at least one position for the row.
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS mean_rank NUMERIC(10, 2);

COMMENT ON COLUMN competitor_asins.title IS 'Best-effort product title from scrapeProductPage, captured when the ASIN was generated.';
COMMENT ON COLUMN competitor_asins.author IS 'Best-effort author from scrapeProductPage, captured when the ASIN was generated.';
COMMENT ON COLUMN competitor_asins.price IS 'Best-effort list price (marketplace currency) from scrapeProductPage, captured when the ASIN was generated.';
COMMENT ON COLUMN competitor_asins.bsr IS 'Best-effort top best-seller-rank from scrapeProductPage, captured when the ASIN was generated.';
COMMENT ON COLUMN competitor_asins.competitor_count IS 'Number of distinct discovery sources that surfaced this ASIN in a single Generate ASINs run.';
COMMENT ON COLUMN competitor_asins.mean_rank IS 'Average 1-based position of this ASIN across the discovery lists it appeared in during a single Generate ASINs run.';
