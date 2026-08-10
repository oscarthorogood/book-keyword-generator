-- Phase 3: Campaign Persistence (Future)
-- This table will store generated campaign metadata for history and reuse
-- Run this AFTER Phase 1 and 2 are complete

-- ============================================================================
-- TABLE: campaigns
-- Purpose: Store generated campaign metadata for history and re-running
-- Relationships: Belongs to authenticated user
-- ============================================================================

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Book Information
  asin TEXT NOT NULL,
  name TEXT NOT NULL, -- Campaign name (e.g., PB_FM_B0BBL2ZW73_...)
  marketplace TEXT NOT NULL DEFAULT 'US',

  -- Generated Data Snapshot
  tropes_keyword_count INTEGER DEFAULT 0,
  comp_names_keyword_count INTEGER DEFAULT 0,
  product_target_count INTEGER DEFAULT 0,
  total_rows INTEGER DEFAULT 0, -- Calculated: sum * row_multiplier

  -- Configuration Snapshot (for re-running)
  match_type_strategy TEXT, -- phrase-only, phrase-exact, all
  daily_budget DECIMAL(10, 2),
  campaign_start_date DATE,
  campaign_end_date DATE,
  bid_model TEXT, -- rrp-based, manual

  -- Full Config JSON for reconstruction
  config_json JSONB, -- Entire form submission for re-running

  -- Generated Keywords (optional, for search)
  keywords_json JSONB, -- { tropes: [...], comp_names: [...], targets: [...] }

  -- Storage Reference
  bulksheet_path TEXT, -- Reference to archived file
  bulksheet_download_url TEXT, -- Last signed URL (may expire)

  -- Status Tracking
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'uploaded', 'active', 'archived')),

  -- Audit Trail
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  uploaded_at TIMESTAMP WITH TIME ZONE,
  archived_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_campaigns_user_id
  ON campaigns(user_id);

CREATE INDEX IF NOT EXISTS idx_campaigns_asin
  ON campaigns(asin);

CREATE INDEX IF NOT EXISTS idx_campaigns_status
  ON campaigns(status);

CREATE INDEX IF NOT EXISTS idx_campaigns_created_at
  ON campaigns(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_created
  ON campaigns(user_id, created_at DESC);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view only their own campaigns
CREATE POLICY "Users read own campaigns" ON campaigns
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can create campaigns
CREATE POLICY "Users create campaigns" ON campaigns
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own campaigns
CREATE POLICY "Users update own campaigns" ON campaigns
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- TRIGGER: Update updated_at timestamp on changes
-- ============================================================================

CREATE OR REPLACE FUNCTION update_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER campaigns_update_timestamp
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_campaigns_updated_at();

-- ============================================================================
-- HELPER FUNCTION: Get user's campaigns with count stats
-- ============================================================================

CREATE OR REPLACE FUNCTION get_user_campaigns_summary(user_uuid UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  asin TEXT,
  status TEXT,
  total_rows INTEGER,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
SELECT
  id,
  name,
  asin,
  status,
  total_rows,
  created_at
FROM campaigns
WHERE user_id = user_uuid
ORDER BY created_at DESC;
$$ LANGUAGE sql STABLE;

-- ============================================================================
-- VERIFICATION: Check if table created successfully
-- ============================================================================

-- Run this to verify:
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'campaigns';
-- Should return: campaigns

-- Get count of columns:
-- SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'campaigns';
-- Should return: 24 columns
