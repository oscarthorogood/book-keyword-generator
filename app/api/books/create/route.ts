import { parseAmazonInput } from "@/lib/amazonUrl";
import { captureBookSnapshot, DEFAULT_CAPTURE_BUDGET_MS, describeCapture } from "@/lib/bookSnapshot";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { Marketplace } from "@/lib/types";

export const runtime = "nodejs";
// One ASIN in means one full metadata capture (product page, competitor
// crawl, reviews, Q&A, external catalogues) — the same budget the keyword
// generator used to need, moved here so it happens once per book instead of
// on every generate.
//
// The capture (see DEFAULT_CAPTURE_BUDGET_MS) has to finish well before this
// ceiling so there's still time to write the row. Previously it ran
// unbounded and hit the ceiling itself: the function was killed mid-capture,
// the browser got a 504 with no JSON body, and the book was never saved —
// the "couldn't add that book" reports. Budgeting the capture below the
// ceiling means a slow scrape costs metadata, not the book.
export const maxDuration = 60;

const MARKETPLACES: Marketplace[] = ["US", "UK", "CA", "DE", "FR", "IT", "ES"];

/**
 * POST /api/books/create
 * Body: { input: string, marketplace?: Marketplace }
 *   `input` is an Amazon product link or a bare ASIN/ISBN. (`asin` is still
 *   accepted as an alias.)
 *
 * The whole "add a book" flow: one identifier is all the caller supplies.
 * Everything the app knows about the book is captured here, once, and stored
 * on the row as a snapshot (lib/bookSnapshot.ts) — the keyword generator
 * reads that snapshot rather than re-scraping Amazon per run.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawInput = typeof body.input === "string" ? body.input : typeof body.asin === "string" ? body.asin : "";

    if (!rawInput.trim()) {
      return Response.json({ error: "Paste an Amazon book link, or enter an ASIN or ISBN." }, { status: 400 });
    }

    const parsed = parseAmazonInput(rawInput);
    if (!parsed) {
      return Response.json(
        {
          error:
            "That doesn't look like an Amazon book link or an ASIN/ISBN. Links look like amazon.com/dp/B0XXXXXXXX; ASINs are 10 characters; ISBNs are 10 or 13 digits.",
        },
        { status: 400 }
      );
    }

    const { asin } = parsed;
    // A pasted link states its own marketplace, so it wins over the dropdown:
    // scraping a .co.uk listing against amazon.com returns a different book,
    // or nothing at all.
    const marketplace: Marketplace =
      parsed.marketplace ?? (MARKETPLACES.includes(body.marketplace) ? body.marketplace : "US");

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();

    // Checked before scraping, not after: re-adding a book the user already
    // has used to burn a full capture before finding out it was a duplicate.
    const { data: existingBook } = await supabase
      .from("books")
      .select("id")
      .eq("user_id", user.id)
      .eq("asin", asin)
      .eq("marketplace", marketplace)
      .maybeSingle();

    if (existingBook) {
      return Response.json(
        {
          success: false,
          message: "You've already added this book.",
          bookId: existingBook.id,
          book: { id: existingBook.id },
        },
        { status: 409 }
      );
    }

    const snapshot = await captureBookSnapshot(asin, marketplace, { budgetMs: DEFAULT_CAPTURE_BUDGET_MS });

    const { data: newBook, error: insertError } = await supabase
      .from("books")
      .insert({
        user_id: user.id,
        asin,
        marketplace,
        // A failed capture still creates the book so the ASIN isn't lost, but
        // it's labelled honestly and the UI offers a re-fetch rather than
        // silently presenting "Unknown Title" as the book's real title.
        title: snapshot.title ?? `Untitled (${asin})`,
        author: snapshot.author ?? "Unknown author",
        description: snapshot.description ?? null,
        metadata_json: snapshot,
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
      book: newBook,
      captureOk: snapshot.capture.ok,
      warning: describeCapture(snapshot),
    });
  } catch (err) {
    console.error("Error in create book:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
