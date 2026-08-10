import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { fetchAmazonBookMetadata } from "@/lib/amazonLookup";
import { currentUser } from "@/lib/supabaseServer";
import { supabaseServer } from "@/lib/supabaseServer";

/**
 * POST /api/books/create
 * Create a new book by ASIN/ISBN and fetch metadata from Amazon
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { asin, marketplace } = body;

    if (!asin || !marketplace) {
      return Response.json(
        { error: "Missing required fields: asin, marketplace" },
        { status: 400 }
      );
    }

    const normalizedAsin = normalizeAsinOrIsbn(asin);
    if (!normalizedAsin) {
      return Response.json(
        { error: "Invalid ASIN/ISBN format" },
        { status: 400 }
      );
    }

    // Get authenticated user
    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create Supabase client
    const supabase = await supabaseServer();

    // Fetch book metadata from Amazon and other sources
    let bookData;
    try {
      const amazonData = await fetchAmazonBookMetadata(normalizedAsin, marketplace as any);
      bookData = {
        title: amazonData.title || "Unknown Title",
        author: amazonData.author || "Unknown Author",
        description: amazonData.description || null,
        metadata_json: {
          fetched_at: new Date().toISOString(),
          source: "amazon",
          asin: amazonData.asin,
          isbn10: amazonData.isbn10,
          isbn13: amazonData.isbn13,
          price: amazonData.price,
          rating: amazonData.rating,
          reviewCount: amazonData.reviewCount,
          publisher: amazonData.publisher,
          publicationDate: amazonData.publicationDate,
          pageCount: amazonData.pageCount,
          language: amazonData.language,
          dimensions: amazonData.dimensions,
          categoryPath: amazonData.categoryPath,
          bestSellerRanks: amazonData.bestSellerRanks,
          bulletPoints: amazonData.bulletPoints,
          coverImageUrl: amazonData.coverImageUrl,
          qaCount: amazonData.qaCount,
          googleBooksCategories: amazonData.googleBooksCategories,
          openLibrarySubjects: amazonData.openLibrarySubjects,
          goodreadsTags: amazonData.goodreadsTags,
        },
      };
    } catch (lookupError) {
      // Fallback if lookup fails
      console.error("Error fetching Amazon metadata:", lookupError);
      bookData = {
        title: "Unknown Title",
        author: "Unknown Author",
        description: null,
        metadata_json: {
          fetched_at: new Date().toISOString(),
          source: "amazon",
          error: lookupError instanceof Error ? lookupError.message : "Lookup failed",
        },
      };
    }

    // Check if book already exists
    const { data: existingBook } = await supabase
      .from("books")
      .select("id")
      .eq("user_id", user.id)
      .eq("asin", normalizedAsin)
      .eq("marketplace", marketplace)
      .single();

    if (existingBook) {
      return Response.json(
        {
          success: false,
          message: "Book already exists",
          bookId: existingBook.id,
        },
        { status: 409 }
      );
    }

    // Create the book
    const { data: newBook, error: insertError } = await supabase
      .from("books")
      .insert({
        user_id: user.id,
        asin: normalizedAsin,
        marketplace,
        title: bookData.title,
        author: bookData.author,
        description: bookData.description,
        metadata_json: bookData.metadata_json,
        total_keywords: 0,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating book:", insertError);
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      message: "Book created successfully",
      book: newBook,
    });
  } catch (err) {
    console.error("Error in create book:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
