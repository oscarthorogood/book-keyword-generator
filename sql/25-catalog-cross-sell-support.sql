-- Campaigns spec §2.5. Supports Campaign 5 (Catalog Cross-Sell): targeting
-- an author's own other books in the same series.
--
-- Deliberately NOT backfilled from author name: `UPDATE books SET
-- series_key = lower(trim(author))` (an earlier draft's approach) declares
-- every book by an author to be one series, so Campaign 5 would spend real
-- budget cross-targeting unrelated titles — a standalone thriller advertised
-- on a children's picture book. Decision 4 (docs/CAMPAIGNS-PROGRESS.md):
-- left NULL here; a future PR adds a book-page control that suggests the
-- author name as a default, which a human confirms/edits before it's saved.
-- lib/campaignSelection.ts's selectCatalogCrossSellTargets already returns
-- [] for a book with no series_key, composing with the existing
-- "skip campaigns with zero eligible targets" rule.

BEGIN;

ALTER TABLE books ADD COLUMN IF NOT EXISTS series_key TEXT;

ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS relationship TEXT
  CHECK (relationship IN ('rival', 'own')) DEFAULT 'rival';

COMMIT;
