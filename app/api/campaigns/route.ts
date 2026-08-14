import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/campaigns (campaigns spec §7)
 *
 * Every sub-campaign across every one of the user's books, joined with its
 * book's title/author and its lifetime spend/sales/ACOS from
 * `campaign_results`. Read-only, for the `/campaigns` overview table.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const [{ data: campaigns, error: campaignsError }, { data: results, error: resultsError }] =
      await Promise.all([
        supabase
          .from("campaigns")
          .select(
            "id, book_id, export_batch_id, campaign_type, name, daily_budget, currency, status, amazon_campaign_id, operation, updated_at, bulksheet_path, last_export_error, last_export_error_at"
          )
          .order("updated_at", { ascending: false }),
        supabase.from("campaign_results").select("campaign_id, spend, sales"),
      ]);
    if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });
    if (resultsError) return Response.json({ error: resultsError.message }, { status: 400 });

    const bookIds = Array.from(new Set((campaigns ?? []).map((c) => c.book_id)));
    const { data: books, error: booksError } =
      bookIds.length > 0
        ? await supabase.from("books").select("id, title, author").in("id", bookIds)
        : { data: [] as { id: string; title: string; author: string }[], error: null };
    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    const bookById = new Map((books ?? []).map((b) => [b.id, b]));

    const totalsByCampaign = new Map<string, { spend: number; sales: number }>();
    for (const r of results ?? []) {
      if (!r.campaign_id) continue;
      const totals = totalsByCampaign.get(r.campaign_id) ?? { spend: 0, sales: 0 };
      totals.spend += Number(r.spend ?? 0);
      totals.sales += Number(r.sales ?? 0);
      totalsByCampaign.set(r.campaign_id, totals);
    }

    const rows = (campaigns ?? []).map((c) => {
      const totals = totalsByCampaign.get(c.id) ?? { spend: 0, sales: 0 };
      return {
        ...c,
        book_title: bookById.get(c.book_id)?.title ?? null,
        book_author: bookById.get(c.book_id)?.author ?? null,
        spend: totals.spend,
        sales: totals.sales,
        acos: totals.sales > 0 ? totals.spend / totals.sales : null,
      };
    });

    return Response.json({ campaigns: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
