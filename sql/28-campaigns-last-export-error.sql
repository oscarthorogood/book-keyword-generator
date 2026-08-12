BEGIN;

-- Persists the last Create/Update Campaign bulksheet-export failure on the
-- campaign row itself (campaigns spec batch 12 item 2). Generation errors
-- were previously only ever shown as a transient client-side alert that
-- vanished on re-render/navigation — this makes the failure visible any
-- time the campaigns list/detail is loaded, not just immediately after the
-- action, and survives a page reload.
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_export_error TEXT;
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_export_error_at TIMESTAMPTZ;

COMMIT;
