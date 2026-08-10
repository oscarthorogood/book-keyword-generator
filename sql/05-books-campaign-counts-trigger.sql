-- Book-Centric System: keep books.campaign_count / total_keywords in sync
--
-- The books.campaign_count and books.total_keywords columns are denormalized
-- summaries read directly by /api/books/list and /api/books/[id] (see
-- get_user_books_summary(), which computes the same numbers live via JOIN but
-- isn't what the API routes actually query). Nothing previously kept these
-- columns updated after a campaign was inserted, updated, or deleted, so
-- every book showed 0 campaigns / 0 keywords in the dashboard and detail page
-- regardless of how many campaigns existed.

CREATE OR REPLACE FUNCTION sync_book_campaign_stats()
RETURNS TRIGGER AS $$
DECLARE
  affected_book_id UUID;
BEGIN
  affected_book_id := COALESCE(NEW.book_id, OLD.book_id);

  IF affected_book_id IS NOT NULL THEN
    UPDATE books
    SET
      campaign_count = (SELECT COUNT(*) FROM campaigns WHERE book_id = affected_book_id),
      total_keywords = (SELECT COALESCE(SUM(total_rows), 0) FROM campaigns WHERE book_id = affected_book_id)
    WHERE id = affected_book_id;
  END IF;

  -- An UPDATE can move a campaign between books (book_id changed); sync the
  -- old parent too so its counts don't stay stale.
  IF TG_OP = 'UPDATE' AND OLD.book_id IS DISTINCT FROM NEW.book_id AND OLD.book_id IS NOT NULL THEN
    UPDATE books
    SET
      campaign_count = (SELECT COUNT(*) FROM campaigns WHERE book_id = OLD.book_id),
      total_keywords = (SELECT COALESCE(SUM(total_rows), 0) FROM campaigns WHERE book_id = OLD.book_id)
    WHERE id = OLD.book_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS campaigns_sync_book_stats ON campaigns;

CREATE TRIGGER campaigns_sync_book_stats
  AFTER INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW
  EXECUTE FUNCTION sync_book_campaign_stats();

-- Backfill existing rows so books created before this trigger existed also
-- show correct counts immediately.
UPDATE books b
SET
  campaign_count = COALESCE((SELECT COUNT(*) FROM campaigns c WHERE c.book_id = b.id), 0),
  total_keywords = COALESCE((SELECT SUM(c.total_rows) FROM campaigns c WHERE c.book_id = b.id), 0);
