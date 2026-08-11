-- Keyword specificity (Enhancements spec §1): a 1 (Broad) – 5 (Very
-- specific) rating shown as a sortable/filterable column in the keyword
-- manager. Computed at generation time in lib/keywordSpecificity.ts,
-- alongside match-type and phrase-length scoring in lib/keywordMerge.ts.
--
-- Store the number, not the label — lib/keywordSpecificity.ts#SPECIFICITY_LABELS
-- maps 1..5 to Broad/Medium/Very specific for display.

ALTER TABLE keywords ADD COLUMN IF NOT EXISTS specificity SMALLINT CHECK (specificity BETWEEN 1 AND 5);

CREATE INDEX IF NOT EXISTS idx_keywords_book_specificity
  ON keywords(book_id, specificity);

COMMENT ON COLUMN keywords.specificity IS
  'Broad (1) to Very specific (5) rating from lib/keywordSpecificity.ts. Null for rows generated before this migration or for negatives, which aren''t scored.';
