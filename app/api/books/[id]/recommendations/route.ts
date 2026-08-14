import {
  recommendForCompetitorAsin,
  recommendForKeyword,
  shouldSuppressRecommendation,
  type KeywordPerformance,
  type PastRecommendation,
  type Recommendation,
} from "@/lib/recommendations";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_TARGET_ACOS = 0.3;

interface RollupRow {
  keyword_id?: string;
  competitor_asin_id?: string;
  lifetime_clicks: number | null;
  lifetime_orders: number | null;
  lifetime_spend: number | null;
}

/**
 * GET /api/books/[id]/recommendations (campaigns spec §6/§7)
 *
 * Regenerates recommendations for every active/paused keyword and
 * competitor ASIN with real results, skips anything within its 30-day
 * rejection cooldown, upserts the survivors (deduped per entity+type by
 * sql/26's partial unique indexes — regeneration supersedes rather than
 * duplicates), and returns the current pending set.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id, target_acos")
      .eq("id", bookId)
      .single();
    if (bookError || !book) return Response.json({ error: "Book not found" }, { status: 404 });
    const targetAcos = (book.target_acos as number | null) ?? DEFAULT_TARGET_ACOS;

    const [keywordPerf, asinPerf, pastRecs] = await Promise.all([
      loadKeywordPerformance(supabase, bookId),
      loadCompetitorAsinPerformance(supabase, bookId),
      loadPastRecommendations(supabase, bookId),
    ]);

    const generated: Array<Recommendation & { entityKind: "keyword" | "asin" }> = [
      ...keywordPerf.flatMap((kw) =>
        recommendForKeyword(kw, targetAcos).map((r) => ({ ...r, entityKind: "keyword" as const }))
      ),
      ...asinPerf.flatMap((asin) =>
        recommendForCompetitorAsin(asin, targetAcos).map((r) => ({
          ...r,
          entityKind: "asin" as const,
        }))
      ),
    ];

    const survivors = generated.filter((rec) => {
      const entityId = rec.keywordId ?? rec.competitorAsinId ?? "";
      return !shouldSuppressRecommendation(rec.type, pastRecs.get(entityId) ?? []);
    });

    const keywordRows = survivors
      .filter((r) => r.entityKind === "keyword")
      .map((r) => toDbRow(r, user.id, bookId));
    const asinRows = survivors
      .filter((r) => r.entityKind === "asin")
      .map((r) => toDbRow(r, user.id, bookId));

    if (keywordRows.length > 0) {
      const { error } = await supabase
        .from("keyword_recommendations")
        .upsert(keywordRows, { onConflict: "keyword_id,type" });
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }
    if (asinRows.length > 0) {
      const { error } = await supabase
        .from("keyword_recommendations")
        .upsert(asinRows, { onConflict: "competitor_asin_id,type" });
      if (error) return Response.json({ error: error.message }, { status: 400 });
    }

    const { data: pending, error: pendingError } = await supabase
      .from("keyword_recommendations")
      .select("*")
      .eq("book_id", bookId)
      .eq("status", "pending")
      .order("generated_at", { ascending: false });
    if (pendingError) return Response.json({ error: pendingError.message }, { status: 400 });

    return Response.json({ recommendations: pending ?? [] });
  } catch (err) {
    console.error("Error generating recommendations:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

function toDbRow(rec: Recommendation, userId: string, bookId: string) {
  return {
    user_id: userId,
    book_id: bookId,
    keyword_id: rec.keywordId ?? null,
    competitor_asin_id: rec.competitorAsinId ?? null,
    type: rec.type,
    current_bid: rec.currentBid ?? null,
    suggested_bid: rec.suggestedBid ?? null,
    reason: rec.reason,
    confidence: rec.confidence,
    status: "pending",
  };
}

async function loadKeywordPerformance(
  supabase: SupabaseClient,
  bookId: string
): Promise<KeywordPerformance[]> {
  const { data: keywords } = await supabase
    .from("keywords")
    .select("id, bid, status, last_clicks, last_spend, last_sales, last_orders, results_updated_at")
    .eq("book_id", bookId)
    .in("status", ["active", "paused"]);
  if (!keywords || keywords.length === 0) return [];

  const ids = keywords.map((k) => k.id as string);
  const [{ data: rollups }, campaignTypeByKeyword] = await Promise.all([
    supabase.from("keyword_result_rollups").select("*").in("keyword_id", ids),
    loadCampaignTypeByKeyword(supabase, bookId, ids),
  ]);
  const rollupById = new Map(
    ((rollups ?? []) as RollupRow[]).map((r) => [r.keyword_id as string, r])
  );

  return keywords.map((k) => {
    const rollup = rollupById.get(k.id as string);
    return {
      id: k.id as string,
      bid: k.bid as number | null,
      status: k.status as KeywordPerformance["status"],
      campaignType: campaignTypeByKeyword.get(k.id as string) ?? null,
      resultsUpdatedAt: k.results_updated_at as string | null,
      lifetimeClicks: rollup?.lifetime_clicks ?? null,
      lifetimeOrders: rollup?.lifetime_orders ?? null,
      lifetimeSpend: rollup?.lifetime_spend ?? null,
      lastClicks: k.last_clicks as number | null,
      lastSpend: k.last_spend as number | null,
      lastSales: k.last_sales as number | null,
      lastOrders: k.last_orders as number | null,
    };
  });
}

async function loadCompetitorAsinPerformance(
  supabase: SupabaseClient,
  bookId: string
): Promise<KeywordPerformance[]> {
  const { data: asins } = await supabase
    .from("competitor_asins")
    .select("id, bid, status, last_clicks, last_spend, last_sales, last_orders, results_updated_at")
    .eq("book_id", bookId)
    .in("status", ["active", "paused"]);
  if (!asins || asins.length === 0) return [];

  const ids = asins.map((a) => a.id as string);
  const { data: rollups } = await supabase
    .from("competitor_asin_result_rollups")
    .select("*")
    .in("competitor_asin_id", ids);
  const rollupById = new Map(
    ((rollups ?? []) as RollupRow[]).map((r) => [r.competitor_asin_id as string, r])
  );

  return asins.map((a) => {
    const rollup = rollupById.get(a.id as string);
    return {
      id: a.id as string,
      bid: a.bid as number | null,
      status: a.status as KeywordPerformance["status"],
      campaignType: null,
      resultsUpdatedAt: a.results_updated_at as string | null,
      lifetimeClicks: rollup?.lifetime_clicks ?? null,
      lifetimeOrders: rollup?.lifetime_orders ?? null,
      lifetimeSpend: rollup?.lifetime_spend ?? null,
      lastClicks: a.last_clicks as number | null,
      lastSpend: a.last_spend as number | null,
      lastSales: a.last_sales as number | null,
      lastOrders: a.last_orders as number | null,
    };
  });
}

/** Maps keyword_id -> campaigns.campaign_type via campaign_targets. Empty until PR 7 (Create Campaign) has actually exported this book. */
async function loadCampaignTypeByKeyword(
  supabase: SupabaseClient,
  bookId: string,
  keywordIds: string[]
): Promise<Map<string, KeywordPerformance["campaignType"]>> {
  const { data } = await supabase
    .from("campaign_targets")
    .select("keyword_id, campaigns!inner(campaign_type, book_id)")
    .in("keyword_id", keywordIds)
    .eq("campaigns.book_id", bookId);

  const map = new Map<string, KeywordPerformance["campaignType"]>();
  for (const row of data ?? []) {
    const campaign = Array.isArray(row.campaigns) ? row.campaigns[0] : row.campaigns;
    if (row.keyword_id && campaign?.campaign_type) {
      map.set(
        row.keyword_id as string,
        campaign.campaign_type as KeywordPerformance["campaignType"]
      );
    }
  }
  return map;
}

async function loadPastRecommendations(
  supabase: SupabaseClient,
  bookId: string
): Promise<Map<string, PastRecommendation[]>> {
  const { data } = await supabase
    .from("keyword_recommendations")
    .select("keyword_id, competitor_asin_id, type, status, decided_at")
    .eq("book_id", bookId)
    .eq("status", "rejected");

  const map = new Map<string, PastRecommendation[]>();
  for (const row of data ?? []) {
    const entityId = (row.keyword_id ?? row.competitor_asin_id) as string | null;
    if (!entityId) continue;
    const list = map.get(entityId) ?? [];
    list.push({
      type: row.type as PastRecommendation["type"],
      status: row.status as PastRecommendation["status"],
      decidedAt: row.decided_at as string | null,
    });
    map.set(entityId, list);
  }
  return map;
}
