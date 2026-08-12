-- Campaigns spec §2.2. What Update Campaign diffs against: each target's
-- bid/state at the moment it was actually exported. A `keyword_ids UUID[]`
-- column (an earlier draft's approach) gives no referential integrity and
-- can't record per-target bid/state history, which the diff needs.

BEGIN;

CREATE TABLE IF NOT EXISTS campaign_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  keyword_id UUID REFERENCES keywords(id) ON DELETE SET NULL,
  competitor_asin_id UUID REFERENCES competitor_asins(id) ON DELETE SET NULL,

  target_text TEXT NOT NULL,       -- as written to the file, including any '+' BMM prefix
  match_type TEXT,                 -- broad | phrase | exact, NULL for product targeting
  targeting_expression TEXT,       -- asin="B0..." for product targets
  bid NUMERIC(10,2),
  state TEXT NOT NULL DEFAULT 'enabled' CHECK (state IN ('enabled', 'paused', 'archived')),
  operation TEXT NOT NULL DEFAULT 'Create' CHECK (operation IN ('Create', 'Update', 'Archive')),
  is_negative BOOLEAN NOT NULL DEFAULT false,
  negative_scope TEXT CHECK (negative_scope IN ('campaign', 'ad_group')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaign_targets_campaign ON campaign_targets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_keyword ON campaign_targets(keyword_id);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_asin ON campaign_targets(competitor_asin_id);

ALTER TABLE campaign_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own campaign targets" ON campaign_targets;
CREATE POLICY "Users manage their own campaign targets" ON campaign_targets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMIT;
