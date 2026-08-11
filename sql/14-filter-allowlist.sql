-- Filter tuning: a per-user allowlist that restores a false-positive
-- rejection and keeps the filter pipeline from rejecting that exact text
-- again on any future generate run (Enhancements spec §16 — scoped to the
-- "restore + allowlist" flow on false positives, since moving the full
-- denylist/regex configuration in lib/keywordFilterConfig.ts into a live
-- DB table would mean refactoring the synchronous filter pipeline that
-- lib/keywordFilters.ts's 200 existing tests assert against; deferred as
-- separate, higher-risk follow-up work rather than attempted half-done
-- here).

CREATE TABLE IF NOT EXISTS filter_allowlist (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  keyword_text TEXT NOT NULL,
  -- Which filter's rejection this overrides, kept for context in the UI —
  -- not used to scope the override, which is by exact text across every filter.
  original_filter TEXT,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, keyword_text)
);

CREATE INDEX IF NOT EXISTS idx_filter_allowlist_user_id ON filter_allowlist(user_id);

ALTER TABLE filter_allowlist ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own filter allowlist" ON filter_allowlist;
CREATE POLICY "Users manage own filter allowlist" ON filter_allowlist
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
