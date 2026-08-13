-- Drop filter_allowlist: a table nothing can write to any more.
--
-- The allowlist let a human mark a keyword the filters had rejected as
-- "actually fine", so the next generate run promoted it straight to active
-- instead of archiving it. That was a Keyword Manager feature, and the
-- Keyword Manager is gone — keywords are found, filtered and selected by
-- campaign generation now, with no hand-curation step to disagree with.
--
-- Its only writers were the CRUD routes (app/api/filter-allowlist/**),
-- which had no caller left in the UI. With those removed the table can
-- only ever be empty, which made the read on the generation hot path a
-- guaranteed-empty query and the override branch dead code. Both are
-- removed in the same change:
--
--   app/api/filter-allowlist/route.ts, [id]/route.ts
--   lib/filterAllowlist.ts             findAllowlistOverrides
--   keywords/generate/route.ts         the filter_allowlist read and the
--                                      allowlist-override promotion branch
--
-- Verified empty (0 rows) on the live project before writing this.
--
-- ORDERING: apply this only once the code above is deployed. The currently
-- deployed generate route still SELECTs from filter_allowlist, and dropping
-- the table before that ships would break keyword generation in production.

BEGIN;

DROP TABLE IF EXISTS filter_allowlist CASCADE;

COMMIT;

-- VERIFICATION: should return no rows.
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema = 'public' AND table_name = 'filter_allowlist';
