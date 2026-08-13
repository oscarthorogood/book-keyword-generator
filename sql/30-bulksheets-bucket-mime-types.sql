-- Fix: "mime type text/csv is not supported" on campaign export
--
-- app/api/books/[id]/campaigns/route.ts and
-- app/api/books/[id]/campaigns/[campaignId]/route.ts upload two files per
-- export batch to the `bulksheets` bucket:
--   {batch}-upload.xlsx  (application/vnd.openxmlformats-officedocument.spreadsheetml.sheet)
--   {batch}-review.csv   (text/csv)
--
-- The bucket is created manually via the Supabase dashboard (see
-- 02-storage-bucket-policies.sql), and dashboard bucket creation defaults
-- `allowed_mime_types` to a single type instead of leaving it unrestricted.
-- When that default was set to the xlsx type only, the review CSV upload
-- (fired in parallel with the xlsx upload) fails with "mime type text/csv
-- is not supported", and the campaigns stay in `draft` with
-- last_export_error set.
--
-- Widen the bucket to accept both content types the app actually sends.

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv'
]
WHERE name = 'bulksheets';

-- NOTE: this file was written but never actually run against the live
-- project, so exports kept failing with "mime type text/csv is not supported"
-- until 2026-08-13. If you stand up a new environment, run it — the bucket
-- ships from the dashboard with the xlsx type only.
--
-- VERIFICATION:
-- SELECT name, allowed_mime_types FROM storage.buckets WHERE name = 'bulksheets';
-- Should show both mime types above (or NULL/empty, meaning unrestricted).
