"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Download, Loader2, RefreshCw, Rocket, X } from "lucide-react";

interface Campaign {
  id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  status: string;
  amazon_campaign_id: string | null;
  export_batch_id: string;
  bulksheet_path?: string | null;
  last_export_error?: string | null;
  last_export_error_at?: string | null;
}

/**
 * "Create campaign" / "Update campaign" actions for the 5-campaign
 * structure (campaigns spec §4). Create builds the plan server-side, and —
 * since the spec's typed-confirmation gate is a real budget commitment,
 * not a cosmetic dialog — resubmits with `confirmed: true` only after the
 * user explicitly accepts the computed total. Update diffs live state
 * against the last export and is disabled per sub-campaign until its
 * Amazon Campaign ID is pasted in (spec §4 step 8's persistent "needs
 * Amazon ID" badge). UI copy stays "Create/Update campaign" / "Download
 * bulksheet", not "Upload to Amazon" — this app has no live Ads API
 * integration; the human still uploads the generated file themselves.
 */
export default function CampaignActions({ bookId }: { bookId: string }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [amazonIdDrafts, setAmazonIdDrafts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ campaigns: Campaign[]; downloadUrl: string | null; totalDailyBudget: number } | null>(
    null
  );
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

  async function createCampaign(confirmed = false) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 400 && body.needsConfirmation) {
        const breakdown = (body.plans ?? [])
          .map((p: { name: string; dailyBudget: number }) => `${p.name}: ${p.dailyBudget.toFixed(2)}/day`)
          .join("\n");
        const proceed = window.confirm(
          `This creates ${body.plans?.length ?? "several"} campaign(s) totalling ${Number(body.totalDailyBudget).toFixed(2)}/day:\n\n${breakdown}\n\nContinue?`
        );
        if (proceed) return createCampaign(true);
        return;
      }

      if (!res.ok) {
        setError(body.error ?? "Failed to create campaign");
        return;
      }

      setResult({ campaigns: body.campaigns ?? [], downloadUrl: body.downloadUrl ?? null, totalDailyBudget: body.totalDailyBudget });
      await loadCampaigns();
    } catch {
      setError("Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  }

  async function saveAmazonId(campaignId: string) {
    const amazonCampaignId = (amazonIdDrafts[campaignId] ?? "").trim();
    if (!amazonCampaignId) return;
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amazonCampaignId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to save Amazon Campaign ID");
        return;
      }
      await loadCampaigns();
    } catch {
      setError("Failed to save Amazon Campaign ID");
    }
  }

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
      <div className="action-card-row">
        <button onClick={() => createCampaign(false)} disabled={submitting} className="action-card action-card-secondary">
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              {submitting ? (
                <Loader2 size={20} className="animate-spin" style={{ color: "var(--icon-active)" }} />
              ) : (
                <Rocket size={20} style={{ color: "var(--icon-active)" }} />
              )}
            </span>
          </div>
          <span className="text-md font-semibold">{submitting ? "Creating draft…" : "Create campaign (draft)"}</span>
        </button>
      </div>

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

      {result && (
        <div className="alert mt-2" aria-live="polite">
          <div>
            <p className="alert-title">
              Created {result.campaigns.length} campaign{result.campaigns.length === 1 ? "" : "s"} — {result.totalDailyBudget.toFixed(2)}/day total
            </p>
            {result.campaigns[0] && (
              <a
                href={`/api/books/${bookId}/campaigns/${result.campaigns[0].id}/download`}
                className="btn btn-tertiary btn-sm mt-2"
              >
                <Download size={14} /> Download bulksheet
              </a>
            )}
          </div>
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
              {!c.amazon_campaign_id ? (
                <>
                  <span className="badge badge-warning">needs Amazon ID</span>
                  <input
                    type="text"
                    placeholder="Amazon Campaign ID"
                    className="input input-sm"
                    value={amazonIdDrafts[c.id] ?? ""}
                    onChange={(e) => setAmazonIdDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  />
                  <button className="btn btn-tertiary btn-sm" onClick={() => saveAmazonId(c.id)}>
                    Save
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-tertiary btn-sm"
                  disabled={c.status !== "exported" || updatingId === c.id}
                  onClick={() => updateCampaign(c.id)}
                  title="Re-scores this campaign's targets against the current keyword/ASIN bank, recommendations and imported results, then uploads only what changed"
                >
                  {updatingId === c.id ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <RefreshCw size={14} />
                  )}{" "}
                  Filter & update campaign
                </button>
              )}
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
