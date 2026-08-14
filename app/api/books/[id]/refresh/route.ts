import { describeCapture } from "@/lib/bookSnapshot";
import { loadBookWithSnapshot } from "@/lib/bookStore";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/books/[id]/refresh
 * Re-scrapes the book's Amazon metadata and replaces the stored snapshot.
 * The escape hatch for a capture that hit a bot check at creation time, or
 * for a book whose product page has since changed.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;

    const user = await currentUser();
    if (!user) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = await supabaseServer();
    const loaded = await loadBookWithSnapshot(supabase, bookId, { forceRefresh: true });

    if (!loaded) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }

    return Response.json({
      success: true,
      book: loaded.book,
      captureOk: loaded.snapshot.capture.ok,
      warning: describeCapture(loaded.snapshot),
    });
  } catch (err) {
    console.error("Error refreshing book metadata:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
