import { findNegativeCollisions } from "@/lib/negativeKeywordLibrary";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { MatchType } from "@/lib/types";

export const runtime = "nodejs";

const MATCH_TYPES: Extract<MatchType, "phrase" | "exact">[] = ["phrase", "exact"];

/**
 * GET /api/negative-keywords — the user's whole negative-keyword library
 * (Enhancements spec §15), any scope.
 *
 * POST /api/negative-keywords — add a negative.
 * Body: { keyword, matchType?, scope, genreId?, bookId?, reason?, source? }
 * Returns `collisions`: active keywords (any of the user's books) whose
 * text matches this negative — a warning, never a block.
 */
export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = await supabaseServer();
    const { data, error } = await supabase
      .from("negative_keywords")
      .select("id, keyword, match_type, scope, genre_id, book_id, source, reason, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    if (error) {
      if (/relation .*negative_keywords.* does not exist/i.test(error.message)) {
        return Response.json({ success: true, negatives: [], needsMigration: true });
      }
      return Response.json({ error: error.message }, { status: 400 });
    }

    return Response.json({ success: true, negatives: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const keyword = typeof body.keyword === "string" ? body.keyword.trim() : "";
    if (!keyword) return Response.json({ error: "keyword is required" }, { status: 400 });
    const matchType: (typeof MATCH_TYPES)[number] = MATCH_TYPES.includes(body.matchType) ? body.matchType : "phrase";
    const scope = body.scope === "genre" || body.scope === "book" ? body.scope : "global";
    const genreId = scope === "genre" && typeof body.genreId === "string" ? body.genreId : null;
    const bookId = scope === "book" && typeof body.bookId === "string" ? body.bookId : null;
    if (scope === "genre" && !genreId) return Response.json({ error: "genreId is required for a genre-scoped negative" }, { status: 400 });
    if (scope === "book" && !bookId) return Response.json({ error: "bookId is required for a book-scoped negative" }, { status: 400 });
    const reason = typeof body.reason === "string" ? body.reason : null;
    const source = ["starter", "manual", "promoted-from-rejection", "search-term-report"].includes(body.source)
      ? body.source
      : "manual";

    const supabase = await supabaseServer();

    const { data, error } = await supabase
      .from("negative_keywords")
      .insert({ user_id: user.id, keyword, match_type: matchType, scope, genre_id: genreId, book_id: bookId, reason, source })
      .select()
      .single();

    if (error) return Response.json({ error: error.message }, { status: 400 });

    // Best-effort collision check across every active keyword the user
    // has, so a promoted negative doesn't silently suppress wanted
    // traffic on some other book. Never blocks the insert.
    const { data: activeKeywords } = await supabase
      .from("keywords")
      .select("text")
      .eq("user_id", user.id)
      .eq("status", "active");
    const collisions = findNegativeCollisions(keyword, (activeKeywords ?? []).map((k) => k.text));

    return Response.json({ success: true, negative: data, collisions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
