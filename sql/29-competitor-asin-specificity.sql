-- Competitor-ASIN specificity: the keyword-side "closest match to book"
-- rating (sql/09-keyword-specificity.sql, lib/keywordSpecificity.ts),
-- extended to competitor ASINs. Scored from the ASIN's captured
-- title/author (sql/17-competitor-asin-metadata.sql) against this book's own
-- anchors — see lib/asinSpecificity.ts#scoreAsinSpecificity. Computed when an
-- ASIN is added/generated and recomputed on "Run filter"
-- (app/api/books/[id]/competitors/filter/route.ts), mirroring the keyword
-- pipeline's generate-then-refilter pattern.
--
-- Store the number, not the label — lib/keywordSpecificity.ts#SPECIFICITY_LABELS
-- maps 1..5 to Broad/Medium/Very specific for display; reused as-is rather
-- than duplicated for ASIN rows.

ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS specificity SMALLINT CHECK (specificity BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS idx_competitor_asins_book_specificity
  ON competitor_asins(book_id, specificity);

COMMENT ON COLUMN competitor_asins.specificity IS
  'Broad (1) to Very specific (5) rating from lib/asinSpecificity.ts#scoreAsinSpecificity, scoring how closely the ASIN''s captured title/author matches this book''s own anchors. Null when the ASIN has no title/author metadata yet.';
