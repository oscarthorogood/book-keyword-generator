import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

interface RecommendationRow {
  id: string;
  keyword_id: string | null;
  competitor_asin_id: string | null;
  type: string;
  suggested_bid: number | null;
  reason: string | null;
  status: string;
}

/**
 * POST /api/books/[id]/recommendations/[recId]/accept (campaigns spec §6/§7)
 *
 * Body: { mode?: "archive-only" | "archive-and-block", confirm?: boolean }
 *
 * - archive: "archive-only" (default) sets status='archived' (reversible).
 *   "archive-and-block" sets status='negative' and — for a keyword only —
 *   inserts a negative_keywords row with source='performance-archive', the
 *   same mechanism as the existing filter-pipeline promote-to-negative
 *   button, triggered by performance instead.
 * - increase_bid / decrease_bid: applies suggested_bid to the entity's bid.
 * - reactivate / pause: sets status accordingly.
 * - promote_to_alpha_exact: requires `confirm: true` in the body — the spec
 *   is explicit this needs its own confirmation step, not a one-click
 *   accept, since it moves three campaigns at once. This app only marks the
 *   keyword Exact/active here; negative-exacting it in BMM Discovery and
 *   archiving the BMM row needs real campaign_targets rows, which don't
 *   exist until PR 7 (Create Campaign) has actually exported this book.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; recId: string }> }
) {
  try {
    const { id: bookId, recId } = await params;

    const user = await currentUser();
    if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const mode: "archive-only" | "archive-and-block" =
      body.mode === "archive-and-block" ? "archive-and-block" : "archive-only";
    const confirm = body.confirm === true;

    const supabase = await supabaseServer();

    const { data: rec, error: recError } = await supabase
      .from("keyword_recommendations")
      .select("*")
      .eq("id", recId)
      .eq("book_id", bookId)
      .single();
    if (recError || !rec)
      return Response.json({ error: "Recommendation not found" }, { status: 404 });
    const recommendation = rec as RecommendationRow;

    if (recommendation.status !== "pending") {
      return Response.json(
        { error: `Recommendation is already ${recommendation.status}` },
        { status: 409 }
      );
    }

    if (recommendation.type === "promote_to_alpha_exact" && !confirm) {
      return Response.json(
        { error: "promote_to_alpha_exact needs explicit confirmation — pass { confirm: true }" },
        { status: 400 }
      );
    }

    const applyError = await applyRecommendation(supabase, recommendation, mode, user.id);
    if (applyError) return Response.json({ error: applyError }, { status: 400 });

    const { data: updated, error: updateError } = await supabase
      .from("keyword_recommendations")
      .update({ status: "accepted", decided_at: new Date().toISOString() })
      .eq("id", recId)
      .select()
      .single();
    if (updateError) return Response.json({ error: updateError.message }, { status: 400 });

    return Response.json({ recommendation: updated });
  } catch (err) {
    console.error("Error accepting recommendation:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}

async function applyRecommendation(
  supabase: SupabaseClient,
  rec: RecommendationRow,
  mode: "archive-only" | "archive-and-block",
  userId: string
): Promise<string | null> {
  const table = rec.keyword_id ? "keywords" : "competitor_asins";
  const entityId = rec.keyword_id ?? rec.competitor_asin_id;
  if (!entityId) return "Recommendation has no keyword or competitor ASIN attached";

  switch (rec.type) {
    case "archive": {
      const status = mode === "archive-and-block" ? "negative" : "archived";
      const { error } = await supabase.from(table).update({ status }).eq("id", entityId);
      if (error) return error.message;

      if (mode === "archive-and-block" && rec.keyword_id) {
        const { data: keyword } = await supabase
          .from("keywords")
          .select("text, match_type, book_id")
          .eq("id", entityId)
          .single();
        if (keyword) {
          const { error: negError } = await supabase.from("negative_keywords").insert({
            user_id: userId,
            keyword: keyword.text,
            match_type: keyword.match_type === "exact" ? "exact" : "phrase",
            scope: "book",
            book_id: keyword.book_id,
            source: "performance-archive",
            reason: rec.reason,
          });
          if (negError) return negError.message;
        }
      }
      return null;
    }

    case "increase_bid":
    case "decrease_bid": {
      if (rec.suggested_bid === null) return "Recommendation has no suggested_bid";
      const { error } = await supabase
        .from(table)
        .update({ bid: rec.suggested_bid })
        .eq("id", entityId);
      return error?.message ?? null;
    }

    case "reactivate": {
      const { error } = await supabase.from(table).update({ status: "active" }).eq("id", entityId);
      return error?.message ?? null;
    }

    case "pause": {
      const { error } = await supabase.from(table).update({ status: "paused" }).eq("id", entityId);
      return error?.message ?? null;
    }

    case "promote_to_alpha_exact": {
      if (!rec.keyword_id) return "promote_to_alpha_exact only applies to keywords";
      const { error } = await supabase
        .from("keywords")
        .update({ match_type: "exact", status: "active" })
        .eq("id", entityId);
      return error?.message ?? null;
    }

    default:
      return `Unknown recommendation type: ${rec.type}`;
  }
}
