-- Phase 1: Create access_requests table for magic link authentication
-- Copy-paste this entire query into Supabase SQL Editor and run

-- ============================================================================
-- TABLE: access_requests
-- Purpose: Tracks user sign-up requests and access control
-- ============================================================================

CREATE TABLE IF NOT EXISTS access_requests (
  email TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  decision_token UUID NOT NULL DEFAULT gen_random_uuid(),
  nonce TEXT, -- For HMAC-signed approval/denial links
  requested_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  notified_at TIMESTAMP WITH TIME ZONE,
  decided_at TIMESTAMP WITH TIME ZONE
);

-- ============================================================================
-- CONSTRAINT: Enforce lowercase emails for case-insensitive lookups
-- ============================================================================

ALTER TABLE access_requests
ADD CONSTRAINT email_lowercase CHECK (email = LOWER(email));

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE access_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own access request
CREATE POLICY "users_read_own_request" ON access_requests
  FOR SELECT
  USING (auth.uid()::text = email);

-- Policy: Service role can do anything (implicit, but being explicit is good)
-- The SUPABASE_SERVICE_ROLE_KEY bypasses RLS entirely

-- ============================================================================
-- INDEXES for query performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_access_requests_status
  ON access_requests(status);

CREATE INDEX IF NOT EXISTS idx_access_requests_requested_at
  ON access_requests(requested_at DESC);

-- ============================================================================
-- VERIFICATION: Check if table created successfully
-- ============================================================================

-- Run this to verify:
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'access_requests';
-- Should return: access_requests
