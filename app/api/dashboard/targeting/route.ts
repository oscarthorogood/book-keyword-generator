import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import {
  computeTargetingSummary,
  type TargetingSourceRow,
  type TargetingTargetRow,
} from "@/lib/dashboardStats";

export const runtime = "nodejs";

/**
 * GET /api/dashboard/targeting?bookId=<uuid>
 *
 * Backs the "Keyword & ASIN funnel" + "Targeting accuracy" widgets
 * (Dashboard hero, Book detail). Scoped to the whole library by default;
 * pass `bookId` to scope to one book's keywords/competitor ASINs, the way
 * the Book detail page's smaller funnel/accuracy cards do.
 *
 * `campaign_targets` has no `book_id` column (it hangs off `campaign_id`),
 * so a book-scoped call filters targets in memory against that book's
 * keyword/ASIN ids rather than joining through campaigns.
 */
export async function GET(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const bookId = new URL(request.url).searchParams.get("bookId");
    const supabase = await supabaseServer();

    let keywordQuery = supabase.from("keywords").select("id, status, last_sales");
    let asinQuery = supabase.from("competitor_asins").select("id, status, last_sales");
    if (bookId) {
      keywordQuery = keywordQuery.eq("book_id", bookId);
      asinQuery = asinQuery.eq("book_id", bookId);
    }

    const [keywordsRes, asinsRes, targetsRes] = await Promise.all([
      keywordQuery,
      asinQuery,
      supabase
        .from("campaign_targets")
        .select("keyword_id, competitor_asin_id, is_negative, state"),
    ]);

    for (const result of [keywordsRes, asinsRes, targetsRes]) {
      if (result.error) return Response.json({ error: result.error.message }, { status: 400 });
    }

    const keywords: TargetingSourceRow[] = (keywordsRes.data ?? []).map((k) => ({
      id: k.id,
      status: k.status,
      lastSales: k.last_sales,
    }));
    const asins: TargetingSourceRow[] = (asinsRes.data ?? []).map((a) => ({
      id: a.id,
      status: a.status,
      lastSales: a.last_sales,
    }));

    let targets: TargetingTargetRow[] = (targetsRes.data ?? []) as TargetingTargetRow[];
    if (bookId) {
      const bookIds = new Set([...keywords.map((k) => k.id), ...asins.map((a) => a.id)]);
      targets = targets.filter(
        (t) =>
          (t.keyword_id && bookIds.has(t.keyword_id)) ||
          (t.competitor_asin_id && bookIds.has(t.competitor_asin_id))
      );
    }

    return Response.json({ summary: computeTargetingSummary(keywords, asins, targets) });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
