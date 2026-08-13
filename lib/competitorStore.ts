/**
 * DB helpers for the competitor-ASIN subsystem (docs/CLAUDE-CODE-COMPETITORS.md
 * §1.3) — small, typed wrappers over `competitor_asins` and
 * `competitor_keywords` (sql/15-competitor-asins.sql), mirroring the pattern
 * lib/bookStore.ts uses for `books`: every function takes the request-scoped
 * Supabase client (lib/supabaseServer.ts) so RLS enforces the user scoping,
 * with `user_id` also filtered explicitly for defense in depth.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompetitorAsin, CompetitorKeyword } from "./types";

const COMPETITOR_ASIN_COLUMNS =
  "id, book_id, competitor_asin, source, notes, status, bid, rejection_reason, rejected_by_filter, title, author, price, bsr, competitor_count, mean_rank, specificity, created_at, updated_at";
const COMPETITOR_KEYWORD_COLUMNS =
  "id, book_id, competitor_asin, text, volume, rank, competitor_count, mean_rank, category, intent_segment, match_type, specificity, status, created_at, updated_at";

// --- competitor_asins --------------------------------------------------

export async function getCompetitorAsins(
  supabase: SupabaseClient,
  bookId: string,
  userId: string
): Promise<CompetitorAsin[]> {
  const { data, error } = await supabase
    .from("competitor_asins")
    .select(COMPETITOR_ASIN_COLUMNS)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load competitor ASINs:", error.message);
    return [];
  }
  return (data ?? []) as CompetitorAsin[];
}

export interface AddCompetitorAsinInput {
  competitorAsin: string;
  source?: CompetitorAsin["source"];
  notes?: string | null;
  title?: string | null;
  author?: string | null;
  specificity?: number | null;
}

export async function addCompetitorAsin(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  input: AddCompetitorAsinInput
): Promise<{ data: CompetitorAsin | null; error: string | null }> {
  const { data, error } = await supabase
    .from("competitor_asins")
    .upsert(
      {
        book_id: bookId,
        user_id: userId,
        competitor_asin: input.competitorAsin.trim().toUpperCase(),
        source: input.source ?? "manual",
        notes: input.notes ?? null,
        title: input.title ?? null,
        author: input.author ?? null,
        specificity: input.specificity ?? null,
      },
      { onConflict: "book_id,competitor_asin", ignoreDuplicates: false }
    )
    .select(COMPETITOR_ASIN_COLUMNS)
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as CompetitorAsin, error: null };
}

export async function deleteCompetitorAsin(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  competitorAsinId: string
): Promise<{ deleted: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("competitor_asins")
    .delete()
    .eq("id", competitorAsinId)
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .select("id");

  if (error) return { deleted: false, error: error.message };
  return { deleted: (data?.length ?? 0) > 0, error: null };
}

/** Delete by id alone (no book scope needed) — for /api/competitors/[id]. */
export async function deleteCompetitorAsinById(
  supabase: SupabaseClient,
  userId: string,
  id: string
): Promise<{ deleted: boolean; error: string | null }> {
  const { data, error } = await supabase
    .from("competitor_asins")
    .delete()
    .eq("id", id)
    .eq("user_id", userId)
    .select("id");

  if (error) return { deleted: false, error: error.message };
  return { deleted: (data?.length ?? 0) > 0, error: null };
}

/** Bulk delete, for the manager's multi-select toolbar. */
export async function deleteCompetitorAsins(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  ids: string[]
): Promise<{ deletedCount: number; error: string | null }> {
  if (ids.length === 0) return { deletedCount: 0, error: null };

  const { data, error } = await supabase
    .from("competitor_asins")
    .delete()
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .in("id", ids)
    .select("id");

  if (error) return { deletedCount: 0, error: error.message };
  return { deletedCount: data?.length ?? 0, error: null };
}

/** Bulk status change, for the manager's multi-select toolbar — mirrors PATCH /api/books/[id]/keywords. */
export async function updateCompetitorAsinsStatus(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  ids: string[],
  status: CompetitorAsin["status"]
): Promise<{ updatedCount: number; error: string | null }> {
  if (ids.length === 0) return { updatedCount: 0, error: null };

  const { data, error } = await supabase
    .from("competitor_asins")
    .update({ status })
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .in("id", ids)
    .select("id");

  if (error) return { updatedCount: 0, error: error.message };
  return { updatedCount: data?.length ?? 0, error: null };
}

export interface UpdateCompetitorAsinInput {
  status?: CompetitorAsin["status"];
  bid?: number | null;
  notes?: string | null;
  title?: string | null;
  author?: string | null;
  price?: number | null;
  bsr?: number | null;
  competitorCount?: number | null;
  meanRank?: number | null;
  specificity?: number | null;
  /** Cleared (set null) by a manual notes edit — see app/api/competitors/[id]/route.ts. */
  presetCompetitorAsinId?: string | null;
}

/** Single-row edit, for inline status/bid/notes editing in the manager table. */
export async function updateCompetitorAsin(
  supabase: SupabaseClient,
  userId: string,
  id: string,
  updates: UpdateCompetitorAsinInput
): Promise<{ data: CompetitorAsin | null; error: string | null }> {
  const payload: Record<string, unknown> = {};
  if (updates.status !== undefined) payload.status = updates.status;
  if (updates.bid !== undefined) payload.bid = updates.bid;
  if (updates.notes !== undefined) payload.notes = updates.notes;
  if (updates.title !== undefined) payload.title = updates.title;
  if (updates.author !== undefined) payload.author = updates.author;
  if (updates.price !== undefined) payload.price = updates.price;
  if (updates.bsr !== undefined) payload.bsr = updates.bsr;
  if (updates.competitorCount !== undefined) payload.competitor_count = updates.competitorCount;
  if (updates.meanRank !== undefined) payload.mean_rank = updates.meanRank;
  if (updates.specificity !== undefined) payload.specificity = updates.specificity;
  if (updates.presetCompetitorAsinId !== undefined) payload.preset_competitor_asin_id = updates.presetCompetitorAsinId;

  const { data, error } = await supabase
    .from("competitor_asins")
    .update(payload)
    .eq("id", id)
    .eq("user_id", userId)
    .select(COMPETITOR_ASIN_COLUMNS)
    .single();

  if (error) return { data: null, error: error.message };
  return { data: data as CompetitorAsin, error: null };
}

// --- competitor_keywords ------------------------------------------------

export interface CompetitorKeywordFilters {
  category?: string;
  matchType?: string;
  minVolume?: number;
  maxRank?: number;
  minCompetitorCount?: number;
}

export async function getCompetitorKeywords(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  filters: CompetitorKeywordFilters = {}
): Promise<CompetitorKeyword[]> {
  let query = supabase
    .from("competitor_keywords")
    .select(COMPETITOR_KEYWORD_COLUMNS)
    .eq("book_id", bookId)
    .eq("user_id", userId);

  if (filters.category) query = query.eq("category", filters.category);
  if (filters.matchType) query = query.eq("match_type", filters.matchType);
  if (filters.minVolume !== undefined) query = query.gte("volume", filters.minVolume);
  if (filters.maxRank !== undefined) query = query.lte("rank", filters.maxRank);
  if (filters.minCompetitorCount !== undefined) query = query.gte("competitor_count", filters.minCompetitorCount);

  const { data, error } = await query.order("volume", { ascending: false });

  if (error) {
    console.error("Failed to load competitor keywords:", error.message);
    return [];
  }
  return (data ?? []) as CompetitorKeyword[];
}

export interface UpsertCompetitorKeywordInput {
  competitorAsin: string;
  text: string;
  volume?: number;
  rank?: number | null;
  competitorCount?: number;
  meanRank?: number | null;
  category?: string | null;
  intentSegment?: string | null;
  matchType?: string;
  specificity?: number | null;
}

/** Bulk upsert, deduped by (book_id, text, competitor_asin) — the unique key on the table. */
export async function upsertCompetitorKeywords(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  rows: UpsertCompetitorKeywordInput[]
): Promise<{ storedCount: number; error: string | null }> {
  if (rows.length === 0) return { storedCount: 0, error: null };

  const payload = rows.map((row) => ({
    book_id: bookId,
    user_id: userId,
    competitor_asin: row.competitorAsin,
    text: row.text,
    volume: row.volume ?? 0,
    rank: row.rank ?? null,
    competitor_count: row.competitorCount ?? 1,
    mean_rank: row.meanRank ?? null,
    category: row.category ?? null,
    intent_segment: row.intentSegment ?? null,
    match_type: row.matchType ?? "phrase",
    specificity: row.specificity ?? null,
  }));

  const { data, error } = await supabase
    .from("competitor_keywords")
    .upsert(payload, { onConflict: "book_id,text,competitor_asin", ignoreDuplicates: false })
    .select("id");

  if (error) return { storedCount: 0, error: error.message };
  return { storedCount: data?.length ?? 0, error: null };
}

export async function deleteCompetitorKeywords(
  supabase: SupabaseClient,
  bookId: string,
  userId: string,
  ids: string[]
): Promise<{ deletedCount: number; error: string | null }> {
  if (ids.length === 0) return { deletedCount: 0, error: null };

  const { data, error } = await supabase
    .from("competitor_keywords")
    .delete()
    .eq("book_id", bookId)
    .eq("user_id", userId)
    .in("id", ids)
    .select("id");

  if (error) return { deletedCount: 0, error: error.message };
  return { deletedCount: data?.length ?? 0, error: null };
}
