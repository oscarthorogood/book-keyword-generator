import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/books/[id]/campaigns/[campaignId]/targets/search?q=&type=keyword|asin
 *
 * Manual Update's swap search: looks up this book's keyword/ASIN bank for
 * anything matching the typed text, so a target can be swapped for an
 * existing bank entry instead of a brand-new one. Excludes whatever is
 * already targeted by this campaign — swapping to something already there
 * isn't a swap. `type` follows the target being swapped: the four
 * keyword-based campaign types search `keywords`, Rival ASIN Offensive and
 * Catalog Cross-Sell search `competitor_asins`.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; campaignId: string }> }) {
  try {
    const { id: bookId, campaignId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(request.url);
    const q = (searchParams.get("q") ?? "").trim();
    const type = searchParams.get("type") === "asin" ? "asin" : "keyword";

    const supabase = await supabaseServer();

    const { data: campaign, error: campaignError } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (campaignError) return Response.json({ error: campaignError.message }, { status: 400 });
    if (!campaign) return Response.json({ error: "Campaign not found" }, { status: 404 });

    const { data: currentTargetRows, error: targetsError } = await supabase
      .from("campaign_targets")
      .select("keyword_id, competitor_asin_id, operation, created_at")
      .eq("campaign_id", campaignId)
      .not(type === "asin" ? "competitor_asin_id" : "keyword_id", "is", null);
    if (targetsError) return Response.json({ error: targetsError.message }, { status: 400 });

    // Same "latest row wins" logic as the plain GET — an id archived by a
    // later row must be searchable again, not hidden as "already targeted".
    const latestOperationById = new Map<string, string>();
    for (const row of currentTargetRows ?? []) {
      const id = type === "asin" ? row.competitor_asin_id : row.keyword_id;
      if (!id) continue;
      const existing = latestOperationById.get(id);
      if (!existing) latestOperationById.set(id, row.operation);
    }
    const excludeIds = new Set(
      [...latestOperationById.entries()].filter(([, op]) => op !== "Archive").map(([id]) => id)
    );

    if (type === "asin") {
      let query = supabase
        .from("competitor_asins")
        .select("id, competitor_asin, status, bid")
        .eq("book_id", bookId)
        .eq("user_id", user.id)
        .in("status", ["active", "paused"])
        .limit(25);
      if (q) query = query.ilike("competitor_asin", `%${q}%`);
      const { data, error } = await query;
      if (error) return Response.json({ error: error.message }, { status: 400 });
      const results = (data ?? [])
        .filter((row) => !excludeIds.has(row.id))
        .map((row) => ({
          id: row.id,
          text: row.competitor_asin,
          targetingExpression: `asin="${row.competitor_asin}"`,
          bid: row.bid,
          type: "asin" as const,
        }));
      return Response.json({ results });
    }

    let query = supabase
      .from("keywords")
      .select("id, text, match_type, status, bid")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .in("status", ["active", "paused"])
      .limit(25);
    if (q) query = query.ilike("text", `%${q}%`);
    const { data, error } = await query;
    if (error) return Response.json({ error: error.message }, { status: 400 });
    const results = (data ?? [])
      .filter((row) => !excludeIds.has(row.id))
      .map((row) => ({
        id: row.id,
        text: row.text,
        matchType: row.match_type,
        bid: row.bid,
        type: "keyword" as const,
      }));
    return Response.json({ results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
