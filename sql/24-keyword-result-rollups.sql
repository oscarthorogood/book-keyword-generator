-- Campaigns spec §2.4. Lifetime figures are derived from campaign_results,
-- never accumulated on keywords/competitor_asins directly — given §2.3's
-- idempotent re-upload design, an incrementing counter would have no way to
-- "un-add" a superseded period. The recommendation engine (PR 10) reads
-- these views as truth; if they get slow, make them materialised and
-- refresh post-import rather than going back to incrementing counters.
--
-- last_* stays as a denormalised cache for fast list rendering, refreshed
-- from the most recent period at the end of each import (PR 8) — the view
-- above is still what correctness-sensitive code (recommendations) reads.

BEGIN;

CREATE OR REPLACE VIEW keyword_result_rollups AS
SELECT keyword_id,
       sum(clicks) AS lifetime_clicks,
       sum(spend)  AS lifetime_spend,
       sum(sales)  AS lifetime_sales,
       sum(orders) AS lifetime_orders,
       max(report_end) AS last_report_end
FROM campaign_results WHERE keyword_id IS NOT NULL GROUP BY keyword_id;

CREATE OR REPLACE VIEW competitor_asin_result_rollups AS
SELECT competitor_asin_id,
       sum(clicks) AS lifetime_clicks,
       sum(spend)  AS lifetime_spend,
       sum(sales)  AS lifetime_sales,
       sum(orders) AS lifetime_orders,
       max(report_end) AS last_report_end
FROM campaign_results WHERE competitor_asin_id IS NOT NULL GROUP BY competitor_asin_id;

ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_impressions INTEGER;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_clicks INTEGER;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_spend NUMERIC(12,2);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_sales NUMERIC(12,2);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_orders INTEGER;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS results_updated_at TIMESTAMPTZ;

ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS last_impressions INTEGER;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS last_clicks INTEGER;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS last_spend NUMERIC(12,2);
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS last_sales NUMERIC(12,2);
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS last_orders INTEGER;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS results_updated_at TIMESTAMPTZ;

COMMIT;
