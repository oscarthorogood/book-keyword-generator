"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Megaphone,
  RefreshCw,
  Rocket,
  Sliders,
  Upload,
  X,
} from "lucide-react";
import ManualUpdateModal from "./ManualUpdateModal";
import ResultsUploadModal from "./ResultsUploadModal";

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

interface BookCampaignsProps {
  bookId: string;
  /** False when the Amazon capture failed — campaigns can't be built from a book with no metadata. */
  metadataReady: boolean;
  /** Lets the page refresh the book header after a run changes its counts. */
  onChanged: () => void;
}

/**
 * The book page's one working surface: this book's campaigns, and the
 * handful of actions that operate on them.
 *
 * Everything to do with the keyword/ASIN bank used to live above this —
 * Generate, Genre Presets, Run Filters, a manual add popup and a 1,300-line
 * keyword table. All of it is gone from the UI. The pipeline still runs, but
 * server-side, inside Create campaigns (lib/campaignPrepare.ts), so the user
 * presses one button instead of four in a specific order.
 *
 * Copy stays "Download bulksheet", never "Upload to Amazon": this app has no
 * Ads API integration and the human still uploads the file themselves.
 */
export default function BookCampaigns({ bookId, metadataReady, onChanged }: BookCampaignsProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [showResultsUpload, setShowResultsUpload] = useState(false);
  const [showManualUpdate, setShowManualUpdate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  /** Fetches without touching state, so effects never set state synchronously. */
  const fetchCampaigns = useCallback(async (): Promise<{ campaigns: Campaign[]; error: string | null }> => {
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns`);
      const body = await res.json().catch(() => ({}));
      if (Array.isArray(body.campaigns)) return { campaigns: body.campaigns, error: null };
      return { campaigns: [], error: body.error || "Could not load campaigns." };
    } catch (err) {
      return { campaigns: [], error: err instanceof Error ? err.message : "Could not load campaigns." };
    }
  }, [bookId]);

  const loadCampaigns = useCallback(async () => {
    const { campaigns: loaded, error: loadError } = await fetchCampaigns();
    setCampaigns(loaded);
    setListError(loadError);
  }, [fetchCampaigns]);

  useEffect(() => {
    let mounted = true;
    fetchCampaigns().then(({ campaigns: loaded, error: loadError }) => {
      if (!mounted) return;
      setCampaigns(loaded);
      setListError(loadError);
      setLoading(false);
    });
    return () => {
      mounted = false;
    };
  }, [fetchCampaigns]);

  /** Shows the server's warnings verbatim — a partial run must not read as a clean one. */
  function reportWarnings(body: { warnings?: unknown }) {
    const warnings = Array.isArray(body.warnings) ? body.warnings.filter((w): w is string => typeof w === "string") : [];
    if (warnings.length > 0) setError(warnings.join(" "));
  }

  async function createCampaigns(confirmed = false) {
    setCreating(true);
    setError(null);
    setNotice(null);
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
        // The second pass re-enters the same route; the bank is populated by
        // now, so it skips generation and goes straight to selection.
        if (proceed) return createCampaigns(true);
        return;
      }

      if (!res.ok) {
        setError(body.error ?? "Could not create campaigns.");
        return;
      }

      const count = body.campaigns?.length ?? 0;
      const prepared = typeof body.prepared === "string" ? `${body.prepared} ` : "";
      setNotice(
        `${prepared}Created ${count} campaign${count === 1 ? "" : "s"} — ${Number(body.totalDailyBudget).toFixed(2)}/day total. Download the bulksheet below and upload it to Amazon Ads.`
      );
      reportWarnings(body);
      await loadCampaigns();
      onChanged();
    } catch {
      setError("Could not create campaigns.");
    } finally {
      setCreating(false);
    }
  }

  async function updateCampaign(campaignId: string) {
    setUpdatingId(campaignId);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Could not update this campaign.");
        return;
      }
      setNotice(body.message ?? `${body.changedCount ?? 0} row(s) changed — download the updated bulksheet below.`);
      await loadCampaigns();
      onChanged();
    } catch {
      setError("Could not update this campaign.");
    } finally {
      setUpdatingId(null);
    }
  }

  const exported = campaigns.filter((c) => c.status === "exported");

  async function updateAll() {
    if (exported.length === 0) return;
    setUpdatingAll(true);
    setError(null);
    setNotice(null);
    try {
      let changed = 0;
      let failed = 0;
      for (const campaign of exported) {
        const res = await fetch(`/api/books/${bookId}/campaigns/${campaign.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) changed += body.changedCount ?? 0;
        else failed += 1;
      }
      // Reports the failures rather than a bare success count.
      if (failed > 0) setError(`${failed} of ${exported.length} campaign(s) could not be updated.`);
      setNotice(`Updated ${exported.length - failed} campaign(s) — ${changed} row(s) changed.`);
      await loadCampaigns();
      onChanged();
    } finally {
      setUpdatingAll(false);
    }
  }

  const downloadable = campaigns.filter((c) => c.bulksheet_path);

  async function downloadAll() {
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Could not download the bulksheets.");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "campaigns-export.xlsx";
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not download the bulksheets.");
    }
  }

  const busy = creating || updatingAll || updatingId !== null;

  return (
    <section className="card">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="card-title">Campaigns</p>
          <p className="meta-line mt-1">
            {loading
              ? "Loading…"
              : campaigns.length === 0
                ? "None yet — creating them researches this book's keywords and competitor ASINs first."
                : `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} · ${campaigns
                    .reduce((sum, c) => sum + c.daily_budget, 0)
                    .toFixed(2)}/day total`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => createCampaigns(false)}
            disabled={busy || !metadataReady}
            className="btn btn-primary"
            title={
              metadataReady
                ? "Researches keywords and competitor ASINs if needed, then builds the campaign bulksheet"
                : "This book's Amazon metadata could not be read — re-fetch it first"
            }
          >
            {creating ? <Loader2 size={20} className="animate-spin" /> : <Rocket size={20} />}
            {creating ? "Creating…" : "Create campaigns"}
          </button>

          {exported.length > 0 && (
            <div className="flex flex-col items-stretch gap-2">
              <button onClick={updateAll} disabled={busy} className="btn btn-secondary" title="Re-scores every campaign against the latest research and results">
                {updatingAll ? <Loader2 size={20} className="animate-spin" /> : <RefreshCw size={20} />}
                Automatic update all
              </button>
              <button
                onClick={() => setShowManualUpdate(true)}
                disabled={busy}
                className="btn btn-secondary"
                title="Pick a campaign and swap individual keywords/ASINs for others from the bank"
              >
                <Sliders size={20} />
                Manual update
              </button>
            </div>
          )}

          {downloadable.length > 0 && (
            <button onClick={downloadAll} className="btn btn-secondary" title="Download one workbook covering every campaign">
              <Download size={20} />
              Download all
            </button>
          )}

          <button
            onClick={() => {
              setError(null);
              setNotice(null);
              setShowResultsUpload(true);
            }}
            className="btn btn-secondary"
            title="Upload an Amazon Search Term Report so updates use real performance"
          >
            <Upload size={20} />
            Upload results
          </button>
        </div>
      </div>

      {creating && (
        <p className="meta-line mb-4" aria-live="polite">
          Researching keywords and competitor ASINs for this book — the first run can take a couple of minutes.
        </p>
      )}

      {error && (
        <div className="alert alert-error mb-4" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="alert alert-success mb-4" aria-live="polite">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{notice}</p>
        </div>
      )}

      {listError && (
        <div className="alert alert-error mb-4" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">Could not load campaigns: {listError}</p>
          <button className="btn btn-tertiary btn-sm" onClick={() => loadCampaigns()}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading campaigns">
          <div className="skeleton h-10 w-full" />
          <div className="skeleton h-10 w-full" />
        </div>
      ) : campaigns.length === 0 ? (
        <div className="empty-state">
          <span className="icon-tile icon-tile-lg">
            <Megaphone size={24} style={{ color: "var(--icon-default)" }} />
          </span>
          <div className="space-y-1">
            <p className="empty-state-title">No campaigns yet</p>
            <p className="empty-state-body">
              Create campaigns builds the full Amazon Ads structure for this book. It researches the keywords and
              competitor ASINs it needs on the way, so there is nothing to set up first.
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table table-dense">
            <thead>
              <tr>
                <th scope="col">Campaign</th>
                <th scope="col">Daily budget</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td>
                    <p className="cell-primary">{campaign.name}</p>
                    {campaign.last_export_error && (
                      <p className="meta-line mt-1" style={{ color: "var(--text-secondary)" }}>
                        {campaign.last_export_error}
                      </p>
                    )}
                  </td>
                  <td>{campaign.daily_budget.toFixed(2)}</td>
                  <td>
                    {campaign.last_export_error ? (
                      <span className="badge badge-error" title="Create campaigns again to retry this export">
                        Export failed
                      </span>
                    ) : campaign.status === "draft" ? (
                      <span className="badge badge-gray">Draft</span>
                    ) : (
                      <span className="badge badge-gray">{campaign.status}</span>
                    )}
                  </td>
                  <td>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {campaign.bulksheet_path && (
                        <a
                          href={`/api/books/${bookId}/campaigns/${campaign.id}/download`}
                          className="btn btn-tertiary btn-sm"
                          title="Download this campaign's bulksheet"
                        >
                          <Download size={14} /> Bulksheet
                        </a>
                      )}
                      <button
                        className="btn btn-tertiary btn-sm"
                        disabled={campaign.status !== "exported" || busy}
                        onClick={() => updateCampaign(campaign.id)}
                        title="Re-scores this campaign against the latest research and imported results, then rebuilds its bulksheet"
                      >
                        {updatingId === campaign.id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Automatic update
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showResultsUpload && (
        <ResultsUploadModal
          bookId={bookId}
          onClose={() => setShowResultsUpload(false)}
          onImported={() => {
            setNotice("Results imported — updating a campaign will now weigh real performance.");
            onChanged();
          }}
        />
      )}

      {showManualUpdate && (
        <ManualUpdateModal
          bookId={bookId}
          campaigns={exported}
          onClose={() => setShowManualUpdate(false)}
          onSwapped={async (message) => {
            setNotice(message);
            await loadCampaigns();
            onChanged();
          }}
        />
      )}
    </section>
  );
}
