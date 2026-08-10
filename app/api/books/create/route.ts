import { createClient } from "@supabase/supabase-js";
import { normalizeAsinOrIsbn } from "@/lib/isbn";

/**
 * POST /api/books/create
 * Create a new book by ASIN/ISBN and fetch metadata
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

    // Get auth header for user context
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Create Supabase client
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    // Placeholder user ID - in production this comes from auth
    const userId = "placeholder-user-id";

    // TODO: Fetch book metadata from Amazon (title, author, categories, rating, etc.)
    // For now, use placeholder data
    const bookData = {
      title: "Book Title",
      author: "Book Author",
      description: null,
      metadata_json: {
        fetched_at: new Date().toISOString(),
        source: "amazon",
        // Metadata will be populated by lookup service
      },
    };

    // Check if book already exists
    const { data: existingBook } = await supabase
      .from("books")
      .select("id")
      .eq("user_id", userId)
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
        user_id: userId,
        asin: normalizedAsin,
        marketplace,
        title: bookData.title,
        author: bookData.author,
        description: bookData.description,
        metadata_json: bookData.metadata_json,
        campaign_count: 0,
        total_keywords: 0,
        total_spend: 0,
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
