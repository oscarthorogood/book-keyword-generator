import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import {
  buildAutocompleteSeeds,
  getAutocompleteKeywordSet,
  scrapeProductPage,
} from "@/lib/scrape";
import {
  ALL_KEYWORD_CATEGORIES,
  buildCategorizedKeywordCandidates,
} from "@/lib/keywordCategories";
import {
  buildGenreMetadataCandidates,
  buildDescriptionMetadataCandidates,
  buildSyntheticGenreKeywords,
  collapseNearDuplicates,
  extractAsinCandidates,
  mergeKeywordCandidates,
  scoreAndTierBids,
} from "@/lib/keywordMerge";
import { validateFinalKeywords } from "@/lib/keywordValidation";
import { enrichBookMetadata } from "@/lib/bookMetadata";
import { KeywordCategory, Marketplace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/books/[id]/keywords/generate
 * Analyses the book (scrape + metadata enrichment + the categorized
 * candidate taxonomy) and inserts the resulting keyword shortlist straight
 * into the keywords table — a book-scoped, campaign-free version of the
 * candidate-generation half of /api/generate.
 * Body: { keyTropes?: string[], keywordCategories?: KeywordCategory[], defaultBid?: number }
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

    const body = await request.json().catch(() => ({}));
    const keyTropes: string[] = Array.isArray(body.keyTropes)
      ? body.keyTropes.filter((t: unknown): t is string => typeof t === "string").slice(0, 50)
      : [];
    const keywordCategories: KeywordCategory[] = Array.isArray(body.keywordCategories)
      ? body.keywordCategories.filter((c: unknown): c is KeywordCategory =>
          typeof c === "string" && ALL_KEYWORD_CATEGORIES.includes(c as KeywordCategory)
        )
      : ALL_KEYWORD_CATEGORIES;
    const defaultBid = typeof body.defaultBid === "number" && body.defaultBid > 0 ? body.defaultBid : 0.5;

    const marketplace = (book.marketplace as Marketplace) || "US";

    const productPage = await scrapeProductPage(book.asin, marketplace);
    const seedTerms = buildAutocompleteSeeds(book.title, book.author);

    const [autocompleteResult, bookMetadata] = await Promise.all([
      getAutocompleteKeywordSet(seedTerms, marketplace),
      enrichBookMetadata({
        isbn10: productPage.isbn10,
        isbn13: productPage.isbn13,
        title: book.title,
        author: book.author,
      }),
    ]);

    const { keywords: autocompleteKeywords } = extractAsinCandidates(autocompleteResult);

    let genreMetadataCandidates = buildGenreMetadataCandidates(bookMetadata);
    if (genreMetadataCandidates.length === 0) {
      genreMetadataCandidates = [
        ...buildDescriptionMetadataCandidates(productPage.description, productPage.bulletPoints),
        ...buildSyntheticGenreKeywords(book.title, productPage.description),
      ];
    }

    const genreSeedTerms = genreMetadataCandidates.map((c) => c.text);
    const categorizedCandidates = buildCategorizedKeywordCandidates({
      title: book.title,
      author: book.author,
      genreTerms: genreSeedTerms,
      categoryPath: productPage.categoryPath ?? [],
      competitors: [],
      compTitles: productPage.compTitles ?? [],
      description: productPage.description,
      bulletPoints: productPage.bulletPoints ?? [],
      keyTropes,
      goodreadsTags: [],
      reviewLanguagePhrases: [],
      enabledCategories: new Set(keywordCategories),
    });

    const merged = mergeKeywordCandidates(
      autocompleteKeywords,
      genreMetadataCandidates,
      categorizedCandidates
    );
    const deduped = collapseNearDuplicates(merged);
    const scored = scoreAndTierBids(deduped, defaultBid);
    const finalCandidates = validateFinalKeywords(scored, defaultBid).slice(0, 150);

    if (finalCandidates.length === 0) {
      return Response.json(
        { error: "No keyword candidates could be generated for this book." },
        { status: 502 }
      );
    }

    const rows = finalCandidates.map((c) => ({
      book_id: bookId,
      user_id: user.id,
      text: c.text,
      match_type: "phrase" as const,
      category: c.category ?? null,
      source: c.sources[0] ?? "generated",
      bid: c.suggestedBid ?? defaultBid,
    }));

    const { data: inserted, error: insertError } = await supabase
      .from("keywords")
      .upsert(rows, { onConflict: "book_id,text,match_type", ignoreDuplicates: true })
      .select();

    if (insertError) {
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      generatedCount: finalCandidates.length,
      insertedCount: inserted?.length ?? 0,
      keywords: inserted,
    });
  } catch (err) {
    console.error("Error generating keywords:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
