-- Corrective migration: sql/24-keyword-result-rollups.sql's two views were
-- created without `security_invoker = true`. Supabase's post-apply security
-- advisor flagged this as an ERROR-level "Security Definer View": by
-- default a Postgres view runs with the *view creator's* permissions, not
-- the querying user's — so keyword_result_rollups and
-- competitor_asin_result_rollups were bypassing RLS on campaign_results
-- entirely, letting any authenticated user read rollups across every
-- user's keywords/ASINs, not just their own. sql/24 is already applied, so
-- this is a new file rather than an edit.
--
-- security_invoker = true (Postgres 15+, this project runs 17) makes the
-- view respect the querying user's own RLS on campaign_results instead.

BEGIN;

ALTER VIEW keyword_result_rollups SET (security_invoker = true);
ALTER VIEW competitor_asin_result_rollups SET (security_invoker = true);

COMMIT;
