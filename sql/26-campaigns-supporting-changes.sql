-- Campaigns spec §2.6. Remaining supporting changes: target ACOS for the
-- recommendation engine (PR 10, decision 5: flat 30% default), the
-- performance-driven negative source (PR 10's "archive and block" action —
-- same mechanism as the existing promote-to-negative button, triggered by
-- performance instead of the filter pipeline), and the recommendations
-- table itself.

BEGIN;

ALTER TABLE books ADD COLUMN IF NOT EXISTS target_acos NUMERIC DEFAULT 0.30;

ALTER TABLE negative_keywords DROP CONSTRAINT IF EXISTS negative_keywords_source_check;
ALTER TABLE negative_keywords ADD CONSTRAINT negative_keywords_source_check
  CHECK (source IN ('starter', 'manual', 'promoted-from-rejection', 'search-term-report', 'performance-archive'));

CREATE TABLE IF NOT EXISTS keyword_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES keywords(id) ON DELETE CASCADE,
  competitor_asin_id UUID REFERENCES competitor_asins(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'increase_bid', 'decrease_bid', 'archive', 'reactivate', 'pause', 'promote_to_alpha_exact'
  )),
  current_bid NUMERIC(10,2),
  suggested_bid NUMERIC(10,2),
  reason TEXT,
  confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'superseded')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

-- Stops the recommendations panel filling with the same suggestion after
-- every import — only one pending recommendation of a given type per
-- keyword (or per competitor ASIN — the spec's DDL only covers keywords;
-- recommendForCompetitorAsin, lib/recommendations.ts, needs the same dedupe)
-- at a time; regeneration supersedes rather than duplicates (PR 10).
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_rec_per_keyword_type
  ON keyword_recommendations (keyword_id, type) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_rec_per_asin_type
  ON keyword_recommendations (competitor_asin_id, type) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_keyword_recommendations_book ON keyword_recommendations(book_id);

ALTER TABLE keyword_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own recommendations" ON keyword_recommendations;
CREATE POLICY "Users manage their own recommendations" ON keyword_recommendations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMIT;
