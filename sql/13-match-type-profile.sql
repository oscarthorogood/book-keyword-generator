-- Per-book match-type strategy experiment (Enhancements spec §21, AUDIT
-- §7.1-7.3): "mixed" is the current default triple (Broad+Phrase+Exact per
-- keyword, via lib/keywordMerge.ts#pickMatchType); "phrase-only" is the
-- competitor-validated alternative that never uses Broad, so search-term
-- data isn't split three ways for the same term. Configuration +
-- bookkeeping only — not an auto-tuner.

ALTER TABLE books ADD COLUMN IF NOT EXISTS match_type_profile TEXT NOT NULL DEFAULT 'mixed'
  CHECK (match_type_profile IN ('mixed', 'phrase-only'));

COMMENT ON COLUMN books.match_type_profile IS
  'mixed (default Broad/Phrase/Exact split) or phrase-only (Phrase for everything except comp names, which stay Exact).';
