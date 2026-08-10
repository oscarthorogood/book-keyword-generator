import { createClient } from "@supabase/supabase-js";

/**
 * POST /api/campaigns/save - Save campaign for a book
 * Book-centric flow: campaign is created within a book context
 * Users can manage multiple campaigns per book
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();

    const { bookId, campaignName, variant } = body;

    if (!bookId || !campaignName) {
      return Response.json({ error: "Missing required fields: bookId, campaignName" }, { status: 400 });
    }

    // Get user from auth
    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      }
    );

    // For now, use a placeholder user ID - in production this would come from auth
    const userId = "placeholder-user-id";

    // Create campaign record linked to book
    const { error: insertError } = await supabase.from("campaigns").insert({
      user_id: userId,
      book_id: bookId,
      name: campaignName,
      variant: variant || 1,
      status: "draft",
      tropes_keyword_count: 0,
      comp_names_keyword_count: 0,
      product_target_count: 0,
      total_rows: 0,
      daily_budget: 0,
      match_type_strategy: "all",
      config_json: {
        variant,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (insertError) {
      console.error("Error saving campaign:", insertError);
      return Response.json({ error: insertError.message }, { status: 400 });
    }

    return Response.json({
      success: true,
      message: "Campaign saved successfully",
      campaignName,
    });
  } catch (err) {
    console.error("Error in save campaign:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
