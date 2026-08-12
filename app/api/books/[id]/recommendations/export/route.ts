import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

const COLUMNS = ["Type", "Entity", "Current Bid", "Suggested Bid", "Confidence", "Reason", "Generated At"] as const;

function escapeCsv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * GET /api/books/[id]/recommendations/export (campaigns spec §6/§7)
 *
 * A human review sheet of pending recommendations — explicitly not an
 * upload file (nothing here goes to Amazon), so it reuses none of
 * lib/bulksheetSchema.ts's column contract.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: recs, error } = await supabase
      .from("keyword_recommendations")
      .select("type, current_bid, suggested_bid, confidence, reason, generated_at, keyword_id, competitor_asin_id")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("status", "pending")
      .order("generated_at", { ascending: false });
    if (error) return Response.json({ error: error.message }, { status: 400 });

    const keywordIds = (recs ?? []).map((r) => r.keyword_id).filter((id): id is string => !!id);
    const asinIds = (recs ?? []).map((r) => r.competitor_asin_id).filter((id): id is string => !!id);

    const [{ data: keywords }, { data: asins }] = await Promise.all([
      keywordIds.length > 0
        ? supabase.from("keywords").select("id, text").in("id", keywordIds)
        : Promise.resolve({ data: [] as Array<{ id: string; text: string }> }),
      asinIds.length > 0
        ? supabase.from("competitor_asins").select("id, competitor_asin").in("id", asinIds)
        : Promise.resolve({ data: [] as Array<{ id: string; competitor_asin: string }> }),
    ]);
    const keywordText = new Map((keywords ?? []).map((k) => [k.id, k.text]));
    const asinText = new Map((asins ?? []).map((a) => [a.id, a.competitor_asin]));

    const lines = [COLUMNS.join(",")];
    for (const rec of recs ?? []) {
      const entity = rec.keyword_id ? (keywordText.get(rec.keyword_id) ?? rec.keyword_id) : (asinText.get(rec.competitor_asin_id ?? "") ?? rec.competitor_asin_id ?? "");
      const row = [
        rec.type,
        entity,
        rec.current_bid !== null ? String(rec.current_bid) : "",
        rec.suggested_bid !== null ? String(rec.suggested_bid) : "",
        rec.confidence ?? "",
        rec.reason ?? "",
        rec.generated_at,
      ];
      lines.push(row.map((v) => escapeCsv(String(v ?? ""))).join(","));
    }

    return new Response(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="recommendations-review.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("Error exporting recommendations:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
