/**
 * Loads everything Create Campaign (POST) and Update Campaign (PATCH) both
 * need to re-run selection for a book: the keyword/ASIN bank, sibling
 * books, the merged negative list, and BookAnchors. Factored out so the two
 * routes share one loading path instead of duplicating it — Update
 * Campaign's diff (lib/campaignDiff.ts) is only trustworthy if it's
 * comparing against the *same* live-selection logic Create used.
 */

import { loadBookWithSnapshot, type BookRecord } from "./bookStore";
import type { CampaignBook, KeywordWithRollups } from "./campaignSelection";
import { buildBookAnchors, type BookAnchors } from "./keywordAnchors";
import { mergeNegatives, selectApplicableNegatives, type LibraryNegativeRow } from "./negativeKeywordLibrary";
import type { NegativeKeyword } from "./negativeKeywords";
import { matchGenresToBook } from "./presetKeywords";
import type { CompetitorAsin, KeywordSource, MatchType } from "./types";
import type { SupabaseClient } from "@supabase/supabase-js";

interface KeywordRow {
  id: string;
  text: string;
  match_type: MatchType;
  status: string;
  bid: number | null;
  specificity: number | null;
  source: string | null;
  rejection_reason: string | null;
}

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  status: string;
  bid: number | null;
  price: number | null;
  bsr: number | null;
  mean_rank: number | null;
  relationship: string | null;
}

export interface CampaignContext {
  book: BookRecord;
  campaignBook: CampaignBook;
  bank: KeywordWithRollups[];
  asinBank: CompetitorAsin[];
  siblingBooks: CampaignBook[];
  negatives: NegativeKeyword[];
  anchors: BookAnchors;
}

export async function loadCampaignContext(
  supabase: SupabaseClient,
  bookId: string,
  userId: string
): Promise<CampaignContext | null> {
  const loaded = await loadBookWithSnapshot(supabase, bookId, userId);
  if (!loaded) return null;
  const { book, snapshot } = loaded;

  const campaignBook: CampaignBook = {
    id: book.id,
    author: book.author,
    title: book.title,
    series_key: book.series_key ?? null,
    asin: book.asin,
  };

  const [{ data: keywordRows }, { data: asinRows }, { data: siblingRows }, { data: libraryRows }, { data: genreRows }] =
    await Promise.all([
      supabase
        .from("keywords")
        .select("id, text, match_type, status, bid, specificity, source, rejection_reason")
        .eq("book_id", bookId)
        .eq("user_id", userId)
        .in("status", ["active", "paused", "negative"]),
      supabase
        .from("competitor_asins")
        .select("id, competitor_asin, status, bid, price, bsr, mean_rank, relationship")
        .eq("book_id", bookId)
        .eq("user_id", userId)
        .in("status", ["active", "paused"]),
      campaignBook.series_key
        ? supabase
            .from("books")
            .select("id, author, title, series_key, asin")
            .eq("user_id", userId)
            .eq("series_key", campaignBook.series_key)
        : Promise.resolve({ data: [] as CampaignBook[] }),
      supabase.from("negative_keywords").select("keyword, match_type, scope, genre_id, book_id, reason").eq("user_id", userId),
      supabase.from("preset_genres").select("id, name, parent_id").eq("user_id", userId),
    ]);

  const activeKeywords = (keywordRows ?? []).filter((r): r is KeywordRow => r.status !== "negative");
  const bank: KeywordWithRollups[] = activeKeywords.map((row) => ({
    id: row.id,
    text: row.text,
    sources: row.source ? [row.source as KeywordSource] : [],
    matchType: row.match_type,
    specificity: row.specificity ?? undefined,
    status: row.status as KeywordWithRollups["status"],
    bid: row.bid,
  }));

  if (bank.length > 0) {
    const { data: rollups } = await supabase
      .from("keyword_result_rollups")
      .select("keyword_id, lifetime_orders")
      .in(
        "keyword_id",
        bank.map((k) => k.id)
      );
    const ordersByKeywordId = new Map((rollups ?? []).map((r) => [r.keyword_id as string, r.lifetime_orders as number | null]));
    for (const keyword of bank) {
      keyword.lifetimeOrders = ordersByKeywordId.get(keyword.id) ?? undefined;
    }
  }

  const asinBank: CompetitorAsin[] = ((asinRows ?? []) as CompetitorAsinRow[]).map((row) => ({
    id: row.id,
    book_id: bookId,
    competitor_asin: row.competitor_asin,
    source: "manual",
    notes: null,
    status: row.status as CompetitorAsin["status"],
    bid: row.bid,
    rejection_reason: null,
    rejected_by_filter: null,
    title: null,
    author: null,
    price: row.price,
    bsr: row.bsr,
    competitor_count: null,
    mean_rank: row.mean_rank,
    created_at: "",
    updated_at: "",
    relationship: (row.relationship ?? "rival") as CompetitorAsin["relationship"],
  }));

  const siblingBooks: CampaignBook[] = ((siblingRows ?? []) as CampaignBook[]).filter((b) => b.id !== campaignBook.id);

  // Same starter + library negative merge as app/api/books/[id]/keywords/export/route.ts.
  const bookNegatives: NegativeKeyword[] = (keywordRows ?? [])
    .filter((row) => row.status === "negative")
    .map((row) => ({
      text: row.text,
      matchType: (row.match_type === "exact" ? "exact" : "phrase") as "phrase" | "exact",
      reason: row.rejection_reason ?? "",
    }));
  let negatives = bookNegatives;
  if (libraryRows) {
    const genres = (genreRows ?? []).map((g) => ({ id: g.id, name: g.name, parentId: g.parent_id }));
    const matchedGenreIds = new Set(matchGenresToBook(genres, snapshot.genreTerms).map((g) => g.id));
    const applicable: LibraryNegativeRow[] = libraryRows.map((row) => ({
      keyword: row.keyword,
      matchType: row.match_type as "phrase" | "exact",
      scope: row.scope as LibraryNegativeRow["scope"],
      genreId: row.genre_id,
      bookId: row.book_id,
      reason: row.reason,
    }));
    negatives = mergeNegatives(bookNegatives, selectApplicableNegatives(applicable, bookId, matchedGenreIds));
  }

  const anchors = buildBookAnchors({
    title: snapshot.title,
    asin: snapshot.asin,
    author: snapshot.author,
    seriesName: snapshot.seriesName,
    description: snapshot.description,
    genreTerms: snapshot.genreTerms,
    genreFamilies: snapshot.genreFamilies,
    categoryPath: snapshot.categoryPath,
    categories: snapshot.categories,
    goodreadsTags: snapshot.goodreadsTags,
    competitors: snapshot.competitors,
    compTitles: snapshot.compTitles,
    reviewSnippets: snapshot.reviewSnippets,
  });

  return { book, campaignBook, bank, asinBank, siblingBooks, negatives, anchors };
}
