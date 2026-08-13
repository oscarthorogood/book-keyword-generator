import { getCompetitorAsins } from "@/lib/competitorStore";
import { aggregateReverseAsinRows, buildAndStoreCompetitorCandidates, parseReverseAsinRows, type ReverseAsinTool, type ReverseAsinWithAsin } from "@/lib/reverseAsin";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_TOOLS: ReverseAsinTool[] = ["helium10", "sellersprite", "kdpradar", "datadive"];

/**
 * POST /api/books/[id]/reverse-asin-import (spec §2.3, optional)
 *
 * Body: {
 *   rows: Array<{ asin: string, row: Record<string, unknown> }> — parsed CSV
 *     rows, each tagged with the competitor ASIN it came from, so a single
 *     request can carry exports from several competitor ASINs at once.
 *   tool?: "helium10" | "sellersprite" | "kdpradar" | "datadive"
 * }
 *
 * Parses every row with the tool-specific column mapping
 * (lib/reverseAsin.ts), aggregates across ASINs, classifies the survivors and
 * writes them to `competitor_keywords`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();

    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id, asin, author")
      .eq("id", bookId)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) return Response.json({ error: "Book not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const tool: ReverseAsinTool = VALID_TOOLS.includes(body.tool) ? body.tool : "helium10";
    const rawRows: Array<{ asin?: unknown; row?: unknown }> = Array.isArray(body.rows) ? body.rows : [];

    if (rawRows.length === 0) {
      return Response.json({ error: "rows is required (each with an asin and the raw export row)" }, { status: 400 });
    }

    // Group raw rows by ASIN so each is parsed with the right column mapping
    // once, then flattened back into the tagged shape aggregateReverseAsinRows expects.
    const byAsin = new Map<string, Array<Record<string, unknown>>>();
    for (const entry of rawRows) {
      const asin = typeof entry.asin === "string" ? entry.asin.trim().toUpperCase() : "";
      if (!asin || typeof entry.row !== "object" || entry.row === null) continue;
      if (!byAsin.has(asin)) byAsin.set(asin, []);
      byAsin.get(asin)!.push(entry.row as Record<string, unknown>);
    }

    if (byAsin.size === 0) {
      return Response.json({ error: "No valid rows with an asin were provided" }, { status: 400 });
    }

    const taggedRows: ReverseAsinWithAsin[] = [];
    for (const [asin, asinRows] of byAsin.entries()) {
      const parsed = parseReverseAsinRows(asinRows, tool);
      for (const row of parsed) taggedRows.push({ ...row, asin });
    }

    // Known competitor ASINs for this book seed the comp-author/comp-title
    // classification the same way lib/manualCompetitors.ts does for the
    // single-ASIN path — extra beyond whatever manualCompetitors already
    // knows for the book's own ASIN.
    const { data: competitorAsins } = await getCompetitorAsins(supabase, bookId, user.id);
    const extraAuthors: string[] = [];
    const extraTitles: string[] = [];

    const { storedCount, candidateCount } = await buildAndStoreCompetitorCandidates(
      { id: bookId, userId: user.id, author: book.author ?? undefined, asin: book.asin ?? undefined },
      taggedRows,
      extraAuthors,
      extraTitles
    );

    const aggregatedCount = aggregateReverseAsinRows(taggedRows).length;

    return Response.json({
      success: true,
      asinsSeen: byAsin.size,
      rowsParsed: taggedRows.length,
      aggregatedCount,
      candidateCount,
      storedCount,
      knownCompetitorAsins: competitorAsins.length,
    });
  } catch (err) {
    console.error("Error importing reverse-ASIN rows:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
