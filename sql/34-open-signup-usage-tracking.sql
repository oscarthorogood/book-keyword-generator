-- Open signup: anyone with a plausible email can request a sign-in link.
-- The admin-approval queue is gone; access_requests now doubles as a usage
-- log so the admin console can show who's actually using the app.

ALTER TABLE access_requests
  ADD COLUMN IF NOT EXISTS sign_in_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_signed_in_at TIMESTAMP WITH TIME ZONE;

-- Nobody should still be stuck in the old pending-approval state now that
-- there's nothing left to approve them into.
UPDATE access_requests SET status = 'approved' WHERE status = 'pending';
