-- Fix: books.total_keywords reads far too low (often 0) after a Generate run
--
-- sql/08-keyword-filter-status.sql defined the count as
--   COUNT(*) WHERE status NOT IN ('archived', 'rejected')
-- on the reasoning that an archived row had been removed from the book's
-- list by hand, and a rejected one is research exhaust.
--
-- The first half of that stopped being true when generation changed to land
-- every new row in 'archived' (PR #61, "Generation always lands in
-- Archived"): archived no longer means "the user took this out of the list",
-- it means "generated, waiting on Run Filters" — which is the normal state of
-- a freshly generated book and very much part of its keyword list.
--
-- The trigger was never updated to match, so after a Generate run
-- total_keywords counts only the negatives and whatever was already
-- promoted. A book showing "473 keywords" in the Keyword manager reads as
-- "36 keywords" on the book detail page, in the books list, and in the
-- dashboard total, and the "Needs attention" widget flags it for having no
-- active keywords when nothing is actually wrong.
--
-- Count everything except 'rejected'. That matches `keptCount` in
-- components/KeywordManager.tsx — the number the user is shown on the book
-- page — so the denormalised column and the UI finally agree.

CREATE OR REPLACE FUNCTION sync_book_keyword_count()
RETURNS TRIGGER AS $$
DECLARE
  affected_book_id UUID;
BEGIN
  affected_book_id := COALESCE(NEW.book_id, OLD.book_id);

  UPDATE books
  SET total_keywords = (
    SELECT COUNT(*) FROM keywords
    WHERE book_id = affected_book_id
      AND status <> 'rejected'
  )
  WHERE id = affected_book_id;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Recount every book once, so existing books correct themselves immediately
-- rather than only after their next keyword change.
UPDATE books
SET total_keywords = (
  SELECT COUNT(*) FROM keywords
  WHERE keywords.book_id = books.id
    AND keywords.status <> 'rejected'
);

-- VERIFICATION: this should return no rows — every book's stored count
-- should equal a live count of its non-rejected keywords.
-- SELECT b.id, b.title, b.total_keywords,
--        (SELECT COUNT(*) FROM keywords k
--          WHERE k.book_id = b.id AND k.status <> 'rejected') AS live_count
--   FROM books b
--  WHERE b.total_keywords <> (SELECT COUNT(*) FROM keywords k
--                              WHERE k.book_id = b.id AND k.status <> 'rejected');
