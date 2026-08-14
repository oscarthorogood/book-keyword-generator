/**
 * DB helper for the competitor-ASIN subsystem — a typed wrapper over
 * `competitor_asins`, mirroring the pattern lib/bookStore.ts uses for
 * `books`: it takes the request-scoped Supabase client
 * (lib/supabaseServer.ts) and relies on RLS for authorization — every
 * signed-in user shares the same book/ASIN data (sql/35).
 *
 * This file used to carry the full CRUD surface for both `competitor_asins`
 * and `competitor_keywords`, serving the hand-editable ASIN manager. That
 * UI is gone (ASINs are found and filtered by campaign generation, not
 * curated by hand) and `competitor_keywords` is dropped in sql/32, so only
 * the read the generation pipeline actually needs remains.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompetitorAsin } from "./types";
import { withClockSkewRetry } from "./supabaseServer";

const COMPETITOR_ASIN_COLUMNS =
  "id, book_id, competitor_asin, source, notes, status, bid, rejection_reason, rejected_by_filter, title, author, price, bsr, competitor_count, mean_rank, specificity, created_at, updated_at";
export async function getCompetitorAsins(
  supabase: SupabaseClient,
  bookId: string
): Promise<{ data: CompetitorAsin[]; error: string | null }> {
  const { data, error } = await withClockSkewRetry(() =>
    supabase
      .from("competitor_asins")
      .select(COMPETITOR_ASIN_COLUMNS)
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
  );

  if (error) {
    console.error("Failed to load competitor ASINs:", error.message);
    return { data: [], error: error.message };
  }
  return { data: (data ?? []) as CompetitorAsin[], error: null };
}
