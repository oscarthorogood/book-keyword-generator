-- Campaigns spec §2.3. Search Term Report imports must be idempotent:
-- without dedupe, a routine re-upload of last week's report doubles every
-- lifetime figure, and the recommendation engine then archives keywords on
-- spend/orders that never happened.
--
-- result_imports tracks each upload as a job (§7 "make it a job, not a
-- request" — processing/complete/failed), with UNIQUE(book_id, file_hash)
-- catching an identical re-upload before any parsing happens.
-- campaign_results is the row-level import: UNIQUE index below on the
-- report's natural key means a corrected re-upload REPLACES that period
-- (INSERT ... ON CONFLICT DO UPDATE) instead of adding to it.

BEGIN;

CREATE TABLE IF NOT EXISTS result_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  file_hash TEXT NOT NULL,              -- sha256 of uploaded bytes
  report_start DATE NOT NULL,
  report_end DATE NOT NULL,
  row_count INTEGER,
  matched_count INTEGER,
  unmatched_count INTEGER,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing', 'complete', 'failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, file_hash)
);

CREATE INDEX IF NOT EXISTS idx_result_imports_book ON result_imports(book_id);

ALTER TABLE result_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own result imports" ON result_imports;
CREATE POLICY "Users manage their own result imports" ON result_imports
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS campaign_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  import_id UUID NOT NULL REFERENCES result_imports(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  keyword_id UUID REFERENCES keywords(id) ON DELETE SET NULL,
  competitor_asin_id UUID REFERENCES competitor_asins(id) ON DELETE SET NULL,

  -- NOT NULL DEFAULT '' (not nullable) so the unique index below can be a
  -- plain column list instead of wrapping every column in coalesce(...):
  -- Postgres CAN target an expression-based unique index via ON CONFLICT,
  -- but the Supabase JS client's .upsert({ onConflict }) only ever emits a
  -- plain column list, so an expression-based index is unusable from the
  -- app layer (PR 8b's import route needs a working upsert).
  campaign_name TEXT NOT NULL DEFAULT '',
  ad_group_name TEXT NOT NULL DEFAULT '',
  keyword_text TEXT NOT NULL DEFAULT '',
  match_type TEXT NOT NULL DEFAULT '',
  targeting_expression TEXT,

  report_start DATE NOT NULL,
  report_end DATE NOT NULL,

  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  -- Decision 3 (docs/CAMPAIGNS-PROGRESS.md): per-book currency, no schema
  -- default — see campaigns.currency in sql/21-campaigns-table.sql.
  currency TEXT NOT NULL,

  source_file TEXT,
  raw_row JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Deliberately no stored ctr/cvr/cpc/acos — pure functions of the columns
-- above that would drift. Computed in keyword_result_rollups
-- (sql/24-keyword-result-rollups.sql) or in TypeScript.

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_results_period ON campaign_results (
  book_id, campaign_name, ad_group_name, keyword_text, match_type, report_start, report_end
);
CREATE INDEX IF NOT EXISTS idx_campaign_results_keyword ON campaign_results(keyword_id);
CREATE INDEX IF NOT EXISTS idx_campaign_results_asin ON campaign_results(competitor_asin_id);
CREATE INDEX IF NOT EXISTS idx_campaign_results_campaign ON campaign_results(campaign_id);

ALTER TABLE campaign_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own results" ON campaign_results;
CREATE POLICY "Users manage their own results" ON campaign_results
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMIT;
