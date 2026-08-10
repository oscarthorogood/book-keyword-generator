import { fetchAmazonBookMetadata } from "@/lib/amazonLookup";

/**
 * GET /api/lookup?asin=B0XXXXXXXX&marketplace=US
 * Fetch comprehensive book metadata from Amazon and other sources
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const asin = url.searchParams.get("asin");
    const marketplace = (url.searchParams.get("marketplace") || "US") as
      | "US"
      | "UK"
      | "CA"
      | "DE"
      | "FR"
      | "IT"
      | "ES";

    if (!asin) {
      return Response.json({ error: "Missing required parameter: asin" }, { status: 400 });
    }

    const metadata = await fetchAmazonBookMetadata(asin, marketplace);

    return Response.json({
      success: true,
      asin: metadata.asin,
      title: metadata.title,
      author: metadata.author,
      price: metadata.price,
      rating: metadata.rating,
      reviewCount: metadata.reviewCount,
      description: metadata.description,
      isbn10: metadata.isbn10,
      isbn13: metadata.isbn13,
      publisher: metadata.publisher,
      publicationDate: metadata.publicationDate,
      pageCount: metadata.pageCount,
      language: metadata.language,
      dimensions: metadata.dimensions,
      categoryPath: metadata.categoryPath,
      bestSellerRanks: metadata.bestSellerRanks,
      bulletPoints: metadata.bulletPoints,
      coverImageUrl: metadata.coverImageUrl,
      qaCount: metadata.qaCount,
      availability: metadata.availability,
      compDetails: metadata.compDetails,
      frequentlyBoughtTogether: metadata.frequentlyBoughtTogether,
      compareWithSimilar: metadata.compareWithSimilar,
      googleBooksCategories: metadata.googleBooksCategories,
      openLibrarySubjects: metadata.openLibrarySubjects,
      goodreadsTags: metadata.goodreadsTags,
    });
  } catch (error) {
    console.error("Error in lookup:", error);
    const message = error instanceof Error ? error.message : "Failed to lookup book";
    return Response.json({ error: message }, { status: 500 });
  }
}
