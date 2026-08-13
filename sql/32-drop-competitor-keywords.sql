-- Drop competitor_keywords: dead since the Competitors tab stopped managing
-- competitor keywords (PR #34, "Rework Competitors tab to manage ASINs, not
-- competitor keywords").
--
-- Nothing has written to this table since the reverse-ASIN import route was
-- the only remaining writer, and nothing has read it since the competitor-
-- keywords route was the only remaining reader. Both routes had no caller —
-- no UI reached them, and the server-side campaign pipeline
-- (lib/campaignPrepare.ts) never did — so they are removed along with the
-- library code that served them:
--
--   app/api/books/[id]/competitor-keywords/route.ts
--   app/api/books/[id]/reverse-asin-import/route.ts
--   lib/competitorStore.ts    getCompetitorKeywords / upsertCompetitorKeywords
--                             / deleteCompetitorKeywords
--   lib/reverseAsin.ts        aggregateReverseAsinRows
--                             / buildAndStoreCompetitorCandidates
--   lib/keywordCapAndRank.ts  reserveCompetitorSlots
--   lib/types.ts              CompetitorKeyword
--
-- Reverse-ASIN parsing itself is NOT dropped: parseReverseAsinRows and
-- buildReverseAsinCandidates still feed keyword generation, which reads
-- uploaded reverse-ASIN rows straight into `keywords`. Only the separate
-- competitor_keywords staging table goes.
--
-- The competitor ASINs themselves are untouched — `competitor_asins` is
-- live and is what the Rival ASIN Offensive campaign targets.
--
-- NOTE: this is destructive and irreversible. If this table still holds
-- rows you want, export them before running:
--   SELECT * FROM competitor_keywords;

BEGIN;

DROP TABLE IF EXISTS competitor_keywords CASCADE;

COMMIT;

-- VERIFICATION: should return no rows.
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'competitor_keywords';
