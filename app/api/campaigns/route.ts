import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/campaigns (campaigns spec §7)
 *
 * Every sub-campaign across every one of the user's books, joined with its
 * book's title/author and its most recent `campaign_results` rollup (last
 * period spend/sales/ACOS) if one exists. Read-only, for the `/campaigns`
 * overview — grouped client-side by `export_batch_id`.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: campaigns, error: campaignsError } = await supabase
      .from("campaigns")
      .select(
        "id, book_id, export_batch_id, campaign_type, name, daily_budget, currency, status, amazon_campaign_id, operation, updated_at"
      )
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });
    if (campaignsError) return Response.json({ error: campaignsError.message }, { status: 400 });

    const bookIds = Array.from(new Set((campaigns ?? []).map((c) => c.book_id)));
    const { data: books, error: booksError } =
      bookIds.length > 0
        ? await supabase.from("books").select("id, title, author").in("id", bookIds)
        : { data: [] as { id: string; title: string; author: string }[], error: null };
    if (booksError) return Response.json({ error: booksError.message }, { status: 400 });
    const bookById = new Map((books ?? []).map((b) => [b.id, b]));

    const rows = (campaigns ?? []).map((c) => ({
      ...c,
      book_title: bookById.get(c.book_id)?.title ?? null,
      book_author: bookById.get(c.book_id)?.author ?? null,
    }));

    return Response.json({ campaigns: rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
