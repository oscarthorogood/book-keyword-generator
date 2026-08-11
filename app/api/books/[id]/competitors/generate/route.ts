import { loadBookWithSnapshot } from "@/lib/bookStore";
import { getCompetitorAsins } from "@/lib/competitorStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

/**
 * POST /api/books/[id]/competitors/generate
 *
 * "Generate ASINs" — the Competitors-tab equivalent of "Generate keywords":
 * pulls competitor ASINs from the same metadata scrape keyword generation
 * already uses (snapshot.competitors, compAsins, frequentlyBoughtTogether,
 * compareWithSimilar — see lib/productTargets.ts), rather than running a new
 * discovery pass. ASINs already tracked for this book are skipped.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId, user.id);
    if (!loaded) return Response.json({ error: "Book not found" }, { status: 404 });

    const { snapshot, book } = loaded;
    if (!snapshot.capture?.ok) {
      return Response.json(
        {
          error: "This book's Amazon metadata could not be read, so there's no competitor crawl to draw from. Re-fetch the metadata and try again.",
          needsRefresh: true,
        },
        { status: 422 }
      );
    }

    const existing = await getCompetitorAsins(supabase, bookId, user.id);
    const existingAsins = new Set(existing.map((row) => row.competitor_asin.toUpperCase()));
    const ownAsin = (snapshot.asin ?? book.asin ?? "").toUpperCase();

    const candidates = new Map<string, string | null>();

    // 1. Gather from snapshot.competitors
    for (const competitor of snapshot.competitors ?? []) {
      const asin = competitor.asin?.toUpperCase();
      if (!asin || !ASIN_PATTERN.test(asin) || asin === ownAsin || existingAsins.has(asin)) continue;
      const notes = [competitor.title, competitor.author].filter(Boolean).join(" — ") || null;
      candidates.set(asin, notes);
    }

    // 2. Gather from snapshot.compAsins
    for (const asinRaw of snapshot.compAsins ?? []) {
      const asin = asinRaw?.toUpperCase();
      if (!asin || !ASIN_PATTERN.test(asin) || asin === ownAsin || existingAsins.has(asin) || candidates.has(asin)) continue;
      candidates.set(asin, "Related listing");
    }

    // 3. Gather from snapshot.frequentlyBoughtTogether
    for (const item of snapshot.frequentlyBoughtTogether ?? []) {
      const asin = item.asin?.toUpperCase();
      if (!asin || !ASIN_PATTERN.test(asin) || asin === ownAsin || existingAsins.has(asin) || candidates.has(asin)) continue;
      candidates.set(asin, item.title ? `Frequently bought together — ${item.title}` : "Frequently bought together");
    }

    // 4. Gather from snapshot.compareWithSimilar
    for (const item of snapshot.compareWithSimilar ?? []) {
      const asin = item.asin?.toUpperCase();
      if (!asin || !ASIN_PATTERN.test(asin) || asin === ownAsin || existingAsins.has(asin) || candidates.has(asin)) continue;
      candidates.set(asin, item.title ? `Similar title — ${item.title}` : "Similar title");
    }

    const totalCrawled =
      (snapshot.competitors?.length ?? 0) +
      (snapshot.compAsins?.length ?? 0) +
      (snapshot.frequentlyBoughtTogether?.length ?? 0) +
      (snapshot.compareWithSimilar?.length ?? 0);

    if (candidates.size === 0) {
      return Response.json({ success: true, candidateCount: totalCrawled, insertedCount: 0 });
    }

    const rows = Array.from(candidates.entries()).map(([asin, notes]) => ({
      book_id: bookId,
      user_id: user.id,
      competitor_asin: asin,
      source: "auto-crawl",
      notes,
    }));

    const { data, error } = await supabase
      .from("competitor_asins")
      .upsert(rows, { onConflict: "book_id,competitor_asin", ignoreDuplicates: true })
      .select("id");

    if (error) return Response.json({ error: error.message }, { status: 400 });

    return Response.json({
      success: true,
      candidateCount: Math.max(candidates.size, totalCrawled),
      insertedCount: data?.length ?? 0,
    });
  } catch (err) {
    console.error("Error generating competitor ASINs:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
