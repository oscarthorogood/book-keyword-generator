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
  last_impressions: number | null;
  last_clicks: number | null;
  last_spend: number | null;
  last_sales: number | null;
  last_orders: number | null;
  results_updated_at: string | null;
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
  last_impressions: number | null;
  last_clicks: number | null;
  last_spend: number | null;
  last_sales: number | null;
  last_orders: number | null;
  results_updated_at: string | null;
}

/** Full lifetime + last-period performance for one keyword or ASIN — feeds lib/recommendations.ts and lib/campaignRebalance.ts. */
export interface EntityPerformance {
  lifetimeClicks: number | null;
  lifetimeOrders: number | null;
  lifetimeSpend: number | null;
  lastClicks: number | null;
  lastSpend: number | null;
  lastSales: number | null;
  lastOrders: number | null;
  resultsUpdatedAt: string | null;
}

export interface CampaignContext {
  book: BookRecord;
  campaignBook: CampaignBook;
  bank: KeywordWithRollups[];
  asinBank: CompetitorAsin[];
  siblingBooks: CampaignBook[];
  negatives: NegativeKeyword[];
  anchors: BookAnchors;
  /** Performance for every keyword and ASIN in `bank`/`asinBank`, keyed by id — used to update campaigns against real results. */
  performanceById: Map<string, EntityPerformance>;
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
        .select(
          "id, text, match_type, status, bid, specificity, source, rejection_reason, last_impressions, last_clicks, last_spend, last_sales, last_orders, results_updated_at"
        )
        .eq("book_id", bookId)
        .eq("user_id", userId)
        .in("status", ["active", "paused", "negative"]),
      supabase
        .from("competitor_asins")
        .select(
          "id, competitor_asin, status, bid, price, bsr, mean_rank, relationship, last_impressions, last_clicks, last_spend, last_sales, last_orders, results_updated_at"
        )
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

  const performanceById = new Map<string, EntityPerformance>();

  if (bank.length > 0) {
    const { data: rollups } = await supabase
      .from("keyword_result_rollups")
      .select("keyword_id, lifetime_clicks, lifetime_spend, lifetime_orders")
      .in(
        "keyword_id",
        bank.map((k) => k.id)
      );
    const rollupByKeywordId = new Map(
      (rollups ?? []).map((r) => [
        r.keyword_id as string,
        { lifetimeClicks: r.lifetime_clicks as number | null, lifetimeSpend: r.lifetime_spend as number | null, lifetimeOrders: r.lifetime_orders as number | null },
      ])
    );
    for (const keyword of bank) {
      const rollup = rollupByKeywordId.get(keyword.id);
      keyword.lifetimeOrders = rollup?.lifetimeOrders ?? undefined;
    }
    for (const row of activeKeywords) {
      const rollup = rollupByKeywordId.get(row.id);
      performanceById.set(row.id, {
        lifetimeClicks: rollup?.lifetimeClicks ?? null,
        lifetimeOrders: rollup?.lifetimeOrders ?? null,
        lifetimeSpend: rollup?.lifetimeSpend ?? null,
        lastClicks: row.last_clicks ?? null,
        lastSpend: row.last_spend ?? null,
        lastSales: row.last_sales ?? null,
        lastOrders: row.last_orders ?? null,
        resultsUpdatedAt: row.results_updated_at ?? null,
      });
    }
  }

  const asinRowList = (asinRows ?? []) as CompetitorAsinRow[];
  if (asinRowList.length > 0) {
    const { data: asinRollups } = await supabase
      .from("competitor_asin_result_rollups")
      .select("competitor_asin_id, lifetime_clicks, lifetime_spend, lifetime_orders")
      .in(
        "competitor_asin_id",
        asinRowList.map((a) => a.id)
      );
    const asinRollupById = new Map(
      (asinRollups ?? []).map((r) => [
        r.competitor_asin_id as string,
        { lifetimeClicks: r.lifetime_clicks as number | null, lifetimeSpend: r.lifetime_spend as number | null, lifetimeOrders: r.lifetime_orders as number | null },
      ])
    );
    for (const row of asinRowList) {
      const rollup = asinRollupById.get(row.id);
      performanceById.set(row.id, {
        lifetimeClicks: rollup?.lifetimeClicks ?? null,
        lifetimeOrders: rollup?.lifetimeOrders ?? null,
        lifetimeSpend: rollup?.lifetimeSpend ?? null,
        lastClicks: row.last_clicks ?? null,
        lastSpend: row.last_spend ?? null,
        lastSales: row.last_sales ?? null,
        lastOrders: row.last_orders ?? null,
        resultsUpdatedAt: row.results_updated_at ?? null,
      });
    }
  }

  const asinBank: CompetitorAsin[] = asinRowList.map((row) => ({
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

  return { book, campaignBook, bank, asinBank, siblingBooks, negatives, anchors, performanceById };
}
