-- Campaigns spec §2.1 / §1.2. Reverses sql/07-remove-campaigns.sql on
-- purpose: this app is regaining a campaigns table, this time as one row
-- per named sub-campaign of the 5-campaign structure, sharing an
-- export_batch_id per "Create Campaign" run.
--
-- §1.2 fix: sql/05-books-campaign-counts-trigger.sql's
-- sync_book_campaign_stats() is dropped first. Confirmed already gone live
-- (docs/CAMPAIGNS-PREFLIGHT.md V2), but this is re-applied defensively —
-- if it ever exists again, it would reattach to the recreated `campaigns`
-- table and start overwriting books.total_keywords from campaign_count
-- sums, clobbering the dashboard's real keyword counts (it also sums a
-- `total_rows` column this schema doesn't have). The replacement trigger
-- below uses a fresh name and only ever touches active_campaign_count.
--
-- CASCADE drops the trigger along with the function without naming the
-- `campaigns` table directly — `DROP TRIGGER ... ON campaigns` would fail
-- on a fresh apply since IF EXISTS only guards the trigger, not a table
-- that doesn't exist yet (this migration creates `campaigns` below).

BEGIN;

DROP FUNCTION IF EXISTS sync_book_campaign_stats() CASCADE;

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  export_batch_id UUID NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN (
    'brand_guard', 'alpha_exact', 'bmm_discovery',
    'rival_asin_offensive', 'catalog_cross_sell', 'auto_discovery'
  )),

  name TEXT NOT NULL,              -- must match the bulksheet's "Campaign Name" exactly
  amazon_campaign_id TEXT,         -- pasted back after upload; Update Campaign needs it
  operation TEXT NOT NULL DEFAULT 'create' CHECK (operation IN ('create', 'update')),

  daily_budget NUMERIC(10,2) NOT NULL DEFAULT 25.00 CHECK (daily_budget > 0),
  -- Decision 3 (docs/CAMPAIGNS-PROGRESS.md): currency is per-book, derived
  -- from books.marketplace at write time. Deliberately no DEFAULT — every
  -- insert must supply it explicitly rather than silently assuming one
  -- marketplace's currency for every book.
  currency TEXT NOT NULL,
  bidding_strategy TEXT NOT NULL DEFAULT 'dynamic_down_only'
    CHECK (bidding_strategy IN ('dynamic_up_down', 'dynamic_down_only', 'fixed')),
  top_of_search_modifier INTEGER NOT NULL DEFAULT 0 CHECK (top_of_search_modifier BETWEEN 0 AND 900),
  product_pages_modifier INTEGER NOT NULL DEFAULT 0 CHECK (product_pages_modifier BETWEEN 0 AND 900),
  start_date DATE,
  end_date DATE,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'exported', 'live', 'paused', 'archived')),

  bulksheet_path TEXT,
  bulksheet_download_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_date_order CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT campaigns_unique_name_per_user UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_book ON campaigns(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_export_batch ON campaigns(export_batch_id);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own campaigns" ON campaigns;
CREATE POLICY "Users manage their own campaigns" ON campaigns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION update_campaigns_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS campaigns_update_timestamp ON campaigns;
CREATE TRIGGER campaigns_update_timestamp
  BEFORE UPDATE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION update_campaigns_updated_at();

-- §1.2 replacement trigger: only ever touches active_campaign_count, never
-- total_keywords. Added here (rather than with the other §2.6 "supporting
-- changes" columns) because the trigger below needs the column to already
-- exist — deviates from the spec's own file-per-section grouping for that
-- ordering reason; noted in the PR description.
ALTER TABLE books ADD COLUMN IF NOT EXISTS active_campaign_count INTEGER DEFAULT 0;

CREATE OR REPLACE FUNCTION sync_book_active_campaign_count()
RETURNS TRIGGER AS $$
DECLARE
  affected_book_id UUID;
BEGIN
  affected_book_id := COALESCE(NEW.book_id, OLD.book_id);

  IF affected_book_id IS NOT NULL THEN
    UPDATE books
    SET active_campaign_count = (
      SELECT COUNT(*) FROM campaigns
      WHERE book_id = affected_book_id AND status <> 'archived'
    )
    WHERE id = affected_book_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.book_id IS DISTINCT FROM NEW.book_id AND OLD.book_id IS NOT NULL THEN
    UPDATE books
    SET active_campaign_count = (
      SELECT COUNT(*) FROM campaigns
      WHERE book_id = OLD.book_id AND status <> 'archived'
    )
    WHERE id = OLD.book_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS campaigns_sync_active_count ON campaigns;
CREATE TRIGGER campaigns_sync_active_count
  AFTER INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION sync_book_active_campaign_count();

COMMIT;
