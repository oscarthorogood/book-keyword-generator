"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, X } from "lucide-react";

interface Campaign {
  id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  status: string;
  export_batch_id: string;
  bulksheet_path?: string | null;
  last_export_error?: string | null;
  last_export_error_at?: string | null;
}

/**
 * "Update campaign" actions for the 5-campaign structure (campaigns spec
 * §4). Create Campaigns lives in the book page's action bar; this diffs
 * live state against the last export for each already-exported campaign.
 * UI copy stays "Update campaign" / "Download bulksheet", not "Upload to
 * Amazon" — this app has no live Ads API integration; the human still
 * uploads the generated file themselves.
 */
export default function CampaignActions({ bookId }: { bookId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<{ id: string; changedCount: number; downloadUrl: string | null; message?: string } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const loadCampaigns = useCallback(
    (active: () => boolean = () => true) =>
      fetch(`/api/books/${bookId}/campaigns`)
        .then((res) => res.json().catch(() => ({})))
        .then((body) => {
          if (!active()) return;
          if (Array.isArray(body.campaigns)) {
            setCampaigns(body.campaigns);
            setListError(null);
          } else {
            setListError(body.error || "Could not load campaigns.");
          }
        })
        .catch((err) => {
          if (active()) setListError(err instanceof Error ? err.message : "Could not load campaigns.");
        }),
    [bookId]
  );

  useEffect(() => {
    let mounted = true;
    void loadCampaigns(() => mounted);
    return () => {
      mounted = false;
    };
  }, [loadCampaigns]);

  async function updateCampaign(campaignId: string) {
    setUpdatingId(campaignId);
    setError(null);
    setUpdateResult(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to update campaign");
        return;
      }
      setUpdateResult({
        id: campaignId,
        changedCount: body.changedCount ?? 0,
        downloadUrl: body.downloadUrl ?? null,
        message: body.message,
      });
      await loadCampaigns();
    } catch {
      setError("Failed to update campaign");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="mb-6">
      {error && (
        <div className="alert alert-error mt-2" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {listError && (
        <div className="alert alert-error mt-2" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">Could not load campaigns: {listError}</p>
          <button className="btn btn-tertiary btn-sm" onClick={() => loadCampaigns()}>
            Retry
          </button>
        </div>
      )}

      {campaigns.length > 0 && (
        <ul className="meta-line text-xs mt-3 space-y-2">
          {campaigns.map((c) => (
            <li key={c.id} className="flex items-center gap-2 flex-wrap">
              <span>
                {c.name} ({c.daily_budget.toFixed(2)}/day, {c.status === "draft" ? "draft — not yet exported" : c.status})
              </span>
              {c.bulksheet_path && (
                <a
                  href={`/api/books/${bookId}/campaigns/${c.id}/download`}
                  className="btn btn-tertiary btn-sm"
                  title="Download the current bulksheet for this campaign"
                >
                  <Download size={14} /> Download
                </a>
              )}
              {c.last_export_error && (
                <span className="badge badge-error" title={c.last_export_error}>
                  export failed
                </span>
              )}
              <button
                className="btn btn-tertiary btn-sm"
                disabled={c.status !== "exported" || updatingId === c.id}
                onClick={() => updateCampaign(c.id)}
                title="Re-scores this campaign's targets against the current keyword/ASIN bank, recommendations and imported results, then uploads only what changed"
              >
                {updatingId === c.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Filter & update campaign
              </button>
              {updateResult?.id === c.id && (
                <span>
                  {updateResult.message ?? `${updateResult.changedCount} row(s) changed`}
                  {updateResult.downloadUrl && (
                    <>
                      {" "}
                      <a href={`/api/books/${bookId}/campaigns/${c.id}/download`}>Download</a>
                    </>
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
