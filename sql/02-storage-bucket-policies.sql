-- Phase 2: Create Storage Bucket Policies
-- Note: The "bulksheets" bucket itself must be created via Supabase dashboard
-- This script sets up the security policies

-- ============================================================================
-- STORAGE BUCKET: bulksheets
-- Purpose: Private archive of generated campaign bulksheets
-- Privacy: PRIVATE (no public access)
-- Path: {userId}/{YYYY}/{MM}/{DD}/{uuid}-{campaign}.xlsx
-- ============================================================================

-- Create bucket via Supabase dashboard:
-- Storage > Create bucket
--   Name: bulksheets
--   Privacy: Private

-- ============================================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================================

-- Policy: Service role can upload to bucket (for archiving)
-- This is implicit and doesn't need explicit policy - service role bypasses RLS

-- Policy: Users can view/download only their own files
-- INSERT into storage.objects:
CREATE POLICY "Users can upload bulksheets" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'bulksheets'
    AND (auth.uid()::text = (storage.foldername(name))[1])
  );

-- SELECT from storage.objects:
CREATE POLICY "Users can download own bulksheets" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'bulksheets'
    AND (auth.uid()::text = (storage.foldername(name))[1])
  );

-- ============================================================================
-- SIGNED URL GENERATION
-- Handled in application code (lib/supabaseStorage.ts)
-- Signed URLs are valid for 1 hour
-- ============================================================================

-- Lifecycle Policy (optional, Enterprise plan)
-- To auto-delete files older than 90 days:
-- Storage > bulksheets > Settings > Lifecycle rules
--   Path pattern: **
--   Expiry: 90 days

-- ============================================================================
-- VERIFICATION: Check if bucket exists
-- ============================================================================

-- Run this query in SQL Editor:
-- SELECT name, id, created_at, updated_at FROM storage.buckets WHERE name = 'bulksheets';
-- Should return the bulksheets bucket
