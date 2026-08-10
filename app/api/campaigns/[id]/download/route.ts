import { NextResponse } from "next/server";
import { currentUser, supabaseServer } from "@/lib/supabaseServer";
import { createDownloadUrl } from "@/lib/supabaseStorage";

/**
 * GET /api/campaigns/[id]/download
 *
 * Re-signs the campaign's archived bulksheet (the signed URL captured at
 * generation time expires after an hour) and redirects to it, so the
 * Download button on the book detail page always works regardless of how
 * long ago the campaign was generated.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await supabaseServer();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("bulksheet_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (!campaign.bulksheet_path) {
    return NextResponse.json({ error: "No bulksheet has been generated for this campaign yet." }, { status: 404 });
  }

  const url = await createDownloadUrl(campaign.bulksheet_path);
  if (!url) {
    return NextResponse.json({ error: "Could not create a download link." }, { status: 502 });
  }

  return NextResponse.redirect(url);
}
