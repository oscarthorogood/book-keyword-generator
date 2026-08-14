-- Shared workspace: every signed-in user now sees and edits the same data.
--
-- Every table below has been RLS-isolated per `auth.uid() = user_id` since
-- it was created, which was appropriate when this was a single-operator
-- tool with open sign-up as a login gate, not a tenancy boundary (see
-- lib/accessRequests.ts — sign-in is approved by default, there's no
-- per-account data separation implied anywhere in the product). Now that
-- multiple people use the same book library, that per-row ownership check
-- is exactly what's stopping teammates from seeing each other's books,
-- keywords, campaigns, presets, and results.
--
-- This migration replaces the ownership check on every policy below with a
-- plain "is this an authenticated user" check, so any signed-in account has
-- the same read/write access as any other. `user_id` columns, their NOT
-- NULL constraints, and every insert that populates them are left exactly
-- as they are — they still record who created each row (useful history),
-- they just stop being an access boundary.
--
-- Deliberately NOT changed here (scoped out — see PR description):
--   - The per-user UNIQUE constraints on books(user_id, asin, marketplace),
--     preset_genres(user_id, parent_id, name), and negative_keywords'
--     compound key. Two teammates who separately added the same ASIN (or
--     preset genre) before this migration keep two rows; that's a
--     pre-existing-duplicate cleanup, not an access problem.
--   - access_requests' RLS (sql/01) — that table gates *sign-in*, not
--     book/campaign/keyword data, and is a separate concern from this
--     change.

BEGIN;

-- books (sql/04) -------------------------------------------------------
DROP POLICY IF EXISTS "Users read own books" ON books;
CREATE POLICY "Authenticated users read all books" ON books
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users create books" ON books;
CREATE POLICY "Authenticated users create books" ON books
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users update own books" ON books;
CREATE POLICY "Authenticated users update all books" ON books
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- keywords (sql/06) -----------------------------------------------------
DROP POLICY IF EXISTS "Users read own keywords" ON keywords;
CREATE POLICY "Authenticated users read all keywords" ON keywords
  FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users insert own keywords" ON keywords;
CREATE POLICY "Authenticated users insert keywords" ON keywords
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users update own keywords" ON keywords;
CREATE POLICY "Authenticated users update all keywords" ON keywords
  FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users delete own keywords" ON keywords;
CREATE POLICY "Authenticated users delete all keywords" ON keywords
  FOR DELETE
  USING (auth.uid() IS NOT NULL);

-- preset_genres / preset_keywords / book_preset_genres (sql/10) --------
DROP POLICY IF EXISTS "Users manage own preset genres" ON preset_genres;
CREATE POLICY "Authenticated users manage preset genres" ON preset_genres
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users manage own preset keywords" ON preset_keywords;
CREATE POLICY "Authenticated users manage preset keywords" ON preset_keywords
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users manage own book preset subscriptions" ON book_preset_genres;
CREATE POLICY "Authenticated users manage book preset subscriptions" ON book_preset_genres
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- negative_keywords (sql/12) ---------------------------------------------
DROP POLICY IF EXISTS "Users manage own negative keywords" ON negative_keywords;
CREATE POLICY "Authenticated users manage negative keywords" ON negative_keywords
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- competitor_asins (sql/15) -----------------------------------------------
DROP POLICY IF EXISTS "Users manage own competitor asins" ON competitor_asins;
CREATE POLICY "Authenticated users manage competitor asins" ON competitor_asins
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- preset_competitor_asins / book_preset_competitor_asin_genres (sql/18) --
DROP POLICY IF EXISTS "Users manage own preset competitor asins" ON preset_competitor_asins;
CREATE POLICY "Authenticated users manage preset competitor asins" ON preset_competitor_asins
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users manage own book preset competitor asin subscriptions" ON book_preset_competitor_asin_genres;
CREATE POLICY "Authenticated users manage book preset competitor asin subscriptions" ON book_preset_competitor_asin_genres
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- campaigns (sql/21) -------------------------------------------------------
DROP POLICY IF EXISTS "Users manage their own campaigns" ON campaigns;
CREATE POLICY "Authenticated users manage campaigns" ON campaigns
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- campaign_targets (sql/22) -------------------------------------------------
DROP POLICY IF EXISTS "Users manage their own campaign targets" ON campaign_targets;
CREATE POLICY "Authenticated users manage campaign targets" ON campaign_targets
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- result_imports / campaign_results (sql/23) --------------------------------
DROP POLICY IF EXISTS "Users manage their own result imports" ON result_imports;
CREATE POLICY "Authenticated users manage result imports" ON result_imports
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users manage their own results" ON campaign_results;
CREATE POLICY "Authenticated users manage campaign results" ON campaign_results
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- keyword_recommendations (sql/26) -------------------------------------------
DROP POLICY IF EXISTS "Users manage their own recommendations" ON keyword_recommendations;
CREATE POLICY "Authenticated users manage recommendations" ON keyword_recommendations
  FOR ALL USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- storage: bulksheets bucket (sql/02) ----------------------------------------
-- Paths are namespaced {uploaderId}/{date}/{batch}-*, so a teammate
-- downloading a campaign someone else exported was being blocked by the
-- folder-prefix check even though the campaigns row itself is now shared.
DROP POLICY IF EXISTS "Users can upload bulksheets" ON storage.objects;
CREATE POLICY "Authenticated users can upload bulksheets" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'bulksheets' AND auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can download own bulksheets" ON storage.objects;
CREATE POLICY "Authenticated users can download bulksheets" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'bulksheets' AND auth.uid() IS NOT NULL);

COMMIT;

-- VERIFICATION:
-- SELECT tablename, policyname, qual FROM pg_policies
--  WHERE schemaname = 'public' AND qual LIKE '%user_id%';
-- Should return no rows for the tables touched above.
