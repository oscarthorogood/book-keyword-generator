-- Pivot: this app is now a keywords-only organiser. Remove campaigns
-- entirely — the campaigns table, its triggers/functions, and the
-- campaign-derived columns on books.

DROP TABLE IF EXISTS campaigns CASCADE;

DROP FUNCTION IF EXISTS sync_book_campaign_stats() CASCADE;
DROP FUNCTION IF EXISTS update_campaigns_updated_at() CASCADE;
DROP FUNCTION IF EXISTS get_user_campaigns_summary(uuid);
DROP FUNCTION IF EXISTS get_user_books_summary(uuid);

ALTER TABLE books DROP COLUMN IF EXISTS campaign_count;
ALTER TABLE books DROP COLUMN IF EXISTS total_spend;
