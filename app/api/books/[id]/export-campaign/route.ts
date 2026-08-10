import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { buildBulksheet, SpmAdGroup } from "@/lib/bulksheet";
import { archiveBulksheet } from "@/lib/supabaseStorage";
import { saveCampaign } from "@/lib/campaignPersistence";
import { buildAdGroupName, buildCampaignName } from "@/lib/naming";
import { KeywordCandidate, MatchType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/books/[id]/export-campaign
 * Turns this book's active keywords into a Bulksheet campaign — the
 * "generate keywords -> curate in the manager -> export" step of the
 * pivoted flow, reusing the existing bulksheet/persistence machinery
 * instead of the full /api/generate scrape-and-rank pipeline.
 * Body: { creatorInitials: string, dailyBudget: number, startDate: string,
 *          endDate?: string, defaultBid?: number, matchTypes?: MatchType[], variant?: number }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const creatorInitials = typeof body.creatorInitials === "string" ? body.creatorInitials.trim() : "";
    const dailyBudget = typeof body.dailyBudget === "number" && body.dailyBudget > 0 ? body.dailyBudget : null;
    const startDate = typeof body.startDate === "string" ? body.startDate : "";
    const endDate = typeof body.endDate === "string" && body.endDate.trim() ? body.endDate : undefined;
    const matchTypes: MatchType[] = Array.isArray(body.matchTypes) && body.matchTypes.length > 0
      ? body.matchTypes
      : ["broad", "phrase", "exact"];
    const variant = typeof body.variant === "number" && body.variant > 0 ? body.variant : 1;

    if (!creatorInitials) {
      return Response.json({ error: "Creator Initials are required." }, { status: 400 });
    }
    if (!dailyBudget) {
      return Response.json({ error: "Daily Budget must be a positive number." }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return Response.json({ error: "Start Date must be in YYYY-MM-DD format." }, { status: 400 });
    }

    const supabase = await supabaseServer();

    const { data: book, error: bookError } = await supabase
      .from("books")
      .select("id, asin, marketplace, title, author")
      .eq("id", bookId)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    const { data: keywords, error: keywordsError } = await supabase
      .from("keywords")
      .select("*")
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("status", "active");

    if (keywordsError) {
      return Response.json({ error: keywordsError.message }, { status: 400 });
    }
    if (!keywords || keywords.length === 0) {
      return Response.json(
        { error: "No active keywords to export. Generate or add keywords first." },
        { status: 400 }
      );
    }

    // Comp-name/comp-title sourced rows go to the exact-match comp authors
    // & titles ad group; everything else falls into tropes & themes — same
    // split rule as the main pipeline's splitKeywordsByCategory.
    const tropesKeywords: KeywordCandidate[] = [];
    const compNameKeywords: KeywordCandidate[] = [];
    let defaultBid = 0.5;
    for (const row of keywords) {
      const candidate: KeywordCandidate = {
        text: row.text,
        sources: [row.source ?? "manual"],
        suggestedBid: row.bid ?? undefined,
        category: row.category ?? undefined,
      };
      if (row.bid) defaultBid = row.bid;
      if (row.source === "comp-name" || row.source === "comp-title" || row.source === "amazon-recs") {
        compNameKeywords.push(candidate);
      } else {
        tropesKeywords.push(candidate);
      }
    }

    const baseBid = typeof body.defaultBid === "number" && body.defaultBid > 0 ? body.defaultBid : defaultBid;

    const campaignName = buildCampaignName({
      asin: book.asin,
      marketplace: book.marketplace,
      creatorInitials,
      authorName: book.author,
      bookTitle: book.title,
      variant,
    });

    const adGroups: SpmAdGroup[] = [];
    if (tropesKeywords.length > 0) {
      adGroups.push({
        name: buildAdGroupName("tropes"),
        defaultBid: baseBid,
        keywords: tropesKeywords,
        matchTypes,
      });
    }
    if (compNameKeywords.length > 0) {
      adGroups.push({
        name: buildAdGroupName("comp-names"),
        defaultBid: baseBid,
        keywords: compNameKeywords,
        matchTypes: ["exact"],
      });
    }

    const buffer = await buildBulksheet({
      campaignName,
      asin: book.asin,
      author: book.author,
      bookTitle: book.title,
      dailyBudget,
      startDate,
      endDate,
      baseBid,
      adGroups,
      includeMetadataSheet: true,
    });

    const archived = await archiveBulksheet(buffer, campaignName, user.id);

    await saveCampaign({
      userId: user.id,
      bookId,
      asin: book.asin,
      campaignName,
      marketplace: book.marketplace,
      tropesCount: tropesKeywords.length,
      compNamesCount: compNameKeywords.length,
      productTargetCount: 0,
      matchTypeStrategy: matchTypes.length === 3 ? "all" : matchTypes.length === 2 ? "phrase-exact" : "phrase-only",
      dailyBudget,
      bulksheetPath: archived?.path,
      bulksheetDownloadUrl: archived?.signedUrl,
      configJson: {
        asin: book.asin,
        authorName: book.author,
        bookTitle: book.title,
        marketplace: book.marketplace,
        dailyBudget,
        startDate,
        endDate,
        variant,
      },
    });

    const { sendBulksheetEmail } = await import("@/lib/email");
    await sendBulksheetEmail({ to: user.email, campaignName, fileBuffer: buffer });

    return Response.json({
      success: true,
      campaignName,
      tropesKeywordCount: tropesKeywords.length,
      compNameKeywordCount: compNameKeywords.length,
      archiveUrl: archived?.signedUrl ?? null,
    });
  } catch (err) {
    console.error("Error exporting campaign:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
