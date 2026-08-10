import { supabaseAdmin } from "./supabaseAdmin";

export interface CampaignSave {
  userId: string;
  asin: string;
  campaignName: string;
  marketplace: string;
  tropesCount: number;
  compNamesCount: number;
  productTargetCount: number;
  matchTypeStrategy: string;
  dailyBudget: number;
  bulksheetPath?: string;
  bulksheetDownloadUrl?: string;
  configJson: Record<string, unknown>;
}

/**
 * Save generated campaign to database for history and re-running
 */
export async function saveCampaign({
  userId,
  asin,
  campaignName,
  marketplace,
  tropesCount,
  compNamesCount,
  productTargetCount,
  matchTypeStrategy,
  dailyBudget,
  bulksheetPath,
  bulksheetDownloadUrl,
  configJson,
}: CampaignSave): Promise<{ success: boolean; error?: string }> {
  try {
    const client = supabaseAdmin();

    // Check if campaigns table exists
    const { data: tables, error: tableError } = await client
      .from("campaigns")
      .select("id")
      .limit(1);

    // If table doesn't exist, return gracefully
    if (tableError && tableError.code === "PGRST116") {
      console.warn("campaigns table not yet initialized (Phase 3) — skipping persistence");
      return { success: true }; // Not an error, just not initialized yet
    }

    if (tableError) {
      console.error("Error checking campaigns table:", tableError);
      return { success: false, error: tableError.message };
    }

    // Calculate total rows: (sum of keywords) * row multiplier
    const rowMultiplier =
      matchTypeStrategy === "phrase-only" ? 1 : matchTypeStrategy === "phrase-exact" ? 2 : 3;
    const totalRows = (tropesCount + compNamesCount + productTargetCount) * rowMultiplier;

    // Insert campaign
    const { error } = await client.from("campaigns").insert({
      user_id: userId,
      asin,
      name: campaignName,
      marketplace,
      tropes_keyword_count: tropesCount,
      comp_names_keyword_count: compNamesCount,
      product_target_count: productTargetCount,
      total_rows: totalRows,
      match_type_strategy: matchTypeStrategy,
      daily_budget: dailyBudget,
      bulksheet_path: bulksheetPath,
      bulksheet_download_url: bulksheetDownloadUrl,
      config_json: configJson,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      console.error("Error saving campaign:", error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error("Unexpected error saving campaign:", err);
    return {
      success: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}

/**
 * Get user's campaigns from database
 */
export async function getUserCampaigns(userId: string) {
  try {
    const client = supabaseAdmin();
    const { data, error } = await client
      .from("campaigns")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching campaigns:", error);
      return [];
    }

    return data || [];
  } catch (err) {
    console.error("Error fetching campaigns:", err);
    return [];
  }
}
