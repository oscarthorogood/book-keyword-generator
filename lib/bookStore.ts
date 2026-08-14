/**
 * Book row access shared by the routes that need the book *and* its scrape
 * snapshot: keyword generation and the manual re-fetch. Keeps the
 * "capture once, re-capture only when it's missing or stale" rule in one
 * place instead of duplicating it per route.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  captureBookSnapshot,
  DEFAULT_CAPTURE_BUDGET_MS,
  isUsableSnapshot,
  type BookSnapshot,
} from "./bookSnapshot";
import type { Marketplace } from "./types";

export interface BookRecord {
  id: string;
  asin: string;
  marketplace: Marketplace;
  title: string;
  author: string;
  description: string | null;
  total_keywords: number;
  created_at: string;
  metadata_json: unknown;
  /** §21: "mixed" (default triple) or "phrase-only". Falls back to "mixed" on rows from before sql/13. */
  match_type_profile?: "mixed" | "phrase-only";
  /** Campaigns spec §2.5 (sql/25-catalog-cross-sell-support.sql). NULL until a human sets it on the book page — never backfilled from author name. */
  series_key?: string | null;
}

export interface BookWithSnapshot {
  book: BookRecord;
  snapshot: BookSnapshot;
  /** True when this request had to (re-)scrape rather than reuse what was stored. */
  captured: boolean;
}

const BOOK_COLUMNS_LEGACY =
  "id, asin, marketplace, title, author, description, total_keywords, created_at, metadata_json";
const BOOK_COLUMNS = `${BOOK_COLUMNS_LEGACY}, match_type_profile`;

export async function getBook(
  supabase: SupabaseClient,
  bookId: string
): Promise<BookRecord | null> {
  let { data, error } = await supabase
    .from("books")
    .select(BOOK_COLUMNS)
    .eq("id", bookId)
    .maybeSingle();

  // sql/13-match-type-profile.sql not applied yet — retry without the
  // column rather than breaking every book lookup on it.
  if (error && /match_type_profile/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("books")
      .select(BOOK_COLUMNS_LEGACY)
      .eq("id", bookId)
      .maybeSingle());
  }

  if (error || !data) return null;
  const record = data as Record<string, unknown>;
  return {
    ...record,
    match_type_profile:
      (record.match_type_profile as "mixed" | "phrase-only" | undefined) ?? "mixed",
  } as BookRecord;
}

/**
 * Writes a fresh snapshot to the book, keeping the row's identity columns in
 * sync with it. A capture that failed to read the product page must not
 * overwrite a title/author that a previous, successful capture found.
 */
export async function persistSnapshot(
  supabase: SupabaseClient,
  book: BookRecord,
  snapshot: BookSnapshot
): Promise<BookRecord> {
  const update: Record<string, unknown> = { metadata_json: snapshot };
  if (snapshot.title) update.title = snapshot.title;
  if (snapshot.author) update.author = snapshot.author;
  if (snapshot.description) update.description = snapshot.description;

  const { data, error } = await supabase
    .from("books")
    .update(update)
    .eq("id", book.id)
    .select(BOOK_COLUMNS)
    .single();

  if (error || !data) {
    console.error("Failed to persist book snapshot:", error?.message);
    return { ...book, metadata_json: snapshot };
  }
  return data as BookRecord;
}

/**
 * The book plus a usable snapshot. Books added before snapshots existed (and
 * books whose capture predates a snapshot-shape change) are re-captured on
 * first use and the result is written back, so an old library heals itself
 * instead of generating keywords from metadata that isn't there.
 */
export async function loadBookWithSnapshot(
  supabase: SupabaseClient,
  bookId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<BookWithSnapshot | null> {
  const book = await getBook(supabase, bookId);
  if (!book) return null;

  if (!options.forceRefresh && isUsableSnapshot(book.metadata_json)) {
    return { book, snapshot: book.metadata_json, captured: false };
  }

  // Both callers of loadBookWithSnapshot (keyword generation's lazy
  // re-capture, and the manual re-fetch route) run inside a route with a 60s
  // maxDuration, same as "add a book" — the explicit budget leaves headroom
  // so a slow scrape costs metadata instead of the whole request being
  // killed with no response at all.
  const snapshot = await captureBookSnapshot(book.asin, book.marketplace, {
    budgetMs: DEFAULT_CAPTURE_BUDGET_MS,
  });
  const updated = await persistSnapshot(supabase, book, snapshot);
  return { book: updated, snapshot, captured: true };
}
