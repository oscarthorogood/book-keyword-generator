import { currentUser, supabaseServer } from "@/lib/supabaseServer";

export const runtime = "nodejs";

/**
 * GET /api/campaigns/[id]/download — same persistent-download re-signing as
 * app/api/books/[id]/campaigns/[campaignId]/download/route.ts, for the
 * cross-book /campaigns overview and /campaigns/[id] detail pages where the
 * book id isn't part of the URL.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: campaignId } = await params;

  const user = await currentUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await supabaseServer();
  const { data: campaign, error } = await supabase
    .from("campaigns")
    .select("bulksheet_path")
    .eq("id", campaignId)
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
