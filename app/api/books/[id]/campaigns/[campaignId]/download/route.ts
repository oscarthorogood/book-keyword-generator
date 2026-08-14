import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/books/[id]/campaigns/[campaignId]/download
 *
 * Persistent download endpoint (batch 12 item 1) — the `bulksheet_download_url`
 * stored on the campaigns row is a 1-hour signed URL captured at export
 * time, so a "Download" button wired directly to it goes dead after an
 * hour. This route re-signs from the stable `bulksheet_path` on every call
 * and redirects, so the button works any time, not just right after
 * Create/Update Campaign.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; campaignId: string }> }
) {
  const { id: bookId, campaignId } = await params;

  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("bulksheet_path")
    .eq("id", campaignId)
    .eq("book_id", bookId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!campaign?.bulksheet_path) {
    return Response.json(
      { error: "No bulksheet has been exported for this campaign yet." },
      { status: 404 }
    );
  }

  const { data: signed, error: signError } = await supabase.storage
    .from("bulksheets")
    .createSignedUrl(campaign.bulksheet_path, 3600);
  if (signError || !signed?.signedUrl) {
    return Response.json(
      { error: signError?.message ?? "Could not sign the bulksheet URL." },
      { status: 500 }
    );
  }

  return Response.redirect(signed.signedUrl, 302);
}
