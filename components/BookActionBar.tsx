"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  ListChecks,
  Loader2,
  Rocket,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import ResultsUploadModal from "./ResultsUploadModal";

interface Campaign {
  id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  status: string;
  amazon_campaign_id: string | null;
  export_batch_id: string;
  bulksheet_path?: string | null;
}

interface BookActionBarProps {
  bookId: string;
  metadataReady: boolean;
  /** Bumped to force KeywordManager to refetch after a shared action. */
  onDataChanged: () => void;
  onMetadataRefreshed: () => void;
}

async function postJson(url: string, body: unknown = {}) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, data };
}

/**
 * Book page (spec: "Simplify buttons on each book page"): every action that
 * used to be scattered across KeywordManager's action-card row and the page
 * header now lives here, grouped by function.
 * Generate/filter/presets fan out to both the keyword and competitor-ASIN
 * pipelines in one click — the user works the book as a whole, not two
 * parallel tabs.
 */
export default function BookActionBar({ bookId, metadataReady, onDataChanged, onMetadataRefreshed }: BookActionBarProps) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [generating, setGenerating] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [applyingPresets, setApplyingPresets] = useState(false);
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [creatingCampaigns, setCreatingCampaigns] = useState(false);
  const [updatingCampaigns, setUpdatingCampaigns] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showResultsUpload, setShowResultsUpload] = useState(false);

  const fetchCampaigns = useCallback(async (): Promise<Campaign[] | null> => {
    const res = await fetch(`/api/books/${bookId}/campaigns`);
    const body = await res.json().catch(() => ({}));
    return Array.isArray(body.campaigns) ? body.campaigns : null;
  }, [bookId]);

  const loadCampaigns = useCallback(async () => {
    const loaded = await fetchCampaigns();
    if (loaded) setCampaigns(loaded);
  }, [fetchCampaigns]);

  useEffect(() => {
    let active = true;
    fetchCampaigns().then((loaded) => {
      if (active && loaded) setCampaigns(loaded);
    });
    return () => {
      active = false;
    };
  }, [fetchCampaigns]);

  async function generateAll() {
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const [kw, asin] = await Promise.all([
        postJson(`/api/books/${bookId}/keywords/generate`, {}),
        postJson(`/api/books/${bookId}/competitors/generate`, {}),
      ]);
      if (!kw.ok && !asin.ok) {
        setError(kw.data.error || asin.data.error || "Could not generate keywords/ASINs.");
        return;
      }
      const addedKeywords = kw.data.insertedCount ?? 0;
      const addedAsins = asin.data.insertedCount ?? 0;
      setNotice(`Added ${addedKeywords} keyword${addedKeywords === 1 ? "" : "s"} and ${addedAsins} ASIN${addedAsins === 1 ? "" : "s"}.`);
      onDataChanged();
    } finally {
      setGenerating(false);
    }
  }

  async function rerunFiltersAll() {
    setFiltering(true);
    setError(null);
    setNotice(null);
    try {
      const [kw, asin] = await Promise.all([
        postJson(`/api/books/${bookId}/keywords/filter`, {}),
        postJson(`/api/books/${bookId}/competitors/filter`, {}),
      ]);
      if (!kw.ok && !asin.ok) {
        setError(kw.data.error || asin.data.error || "Could not re-run the filters.");
        return;
      }
      setNotice(`Re-checked ${(kw.data.examined ?? 0) + (asin.data.examined ?? 0)} row(s).`);
      onDataChanged();
    } finally {
      setFiltering(false);
    }
  }

  async function addPresetsAll() {
    setApplyingPresets(true);
    setError(null);
    setNotice(null);
    try {
      const [kw, asin] = await Promise.all([
        postJson(`/api/books/${bookId}/keywords/apply-presets`, {}),
        postJson(`/api/books/${bookId}/competitors/apply-presets`, {}),
      ]);
      if (!kw.ok && !asin.ok) {
        setError(kw.data.error || asin.data.error || "Could not apply genre presets.");
        return;
      }
      const applied = (kw.data.appliedCount ?? 0) + (asin.data.appliedCount ?? 0);
      setNotice(applied > 0 ? `Applied ${applied} preset row(s).` : "No new preset rows to apply.");
      if (applied > 0) onDataChanged();
    } finally {
      setApplyingPresets(false);
    }
  }

  async function refreshMetadata() {
    setRefreshingMeta(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/books/${bookId}/refresh`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not re-fetch the metadata.");
        return;
      }
      setNotice(body.warning ?? "Metadata re-fetched from Amazon.");
      onMetadataRefreshed();
    } finally {
      setRefreshingMeta(false);
    }
  }

  async function createCampaigns(confirmed = false) {
    setCreatingCampaigns(true);
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
        if (proceed) return createCampaigns(true);
        return;
      }

      if (!res.ok) {
        setError(body.error ?? "Failed to create campaigns");
        return;
      }

      setNotice(`Created ${body.campaigns?.length ?? 0} campaign(s) — ${Number(body.totalDailyBudget).toFixed(2)}/day total.`);
      await loadCampaigns();
      onDataChanged();
    } finally {
      setCreatingCampaigns(false);
    }
  }

  /** Re-scores and re-uploads every already-exported campaign that has an Amazon Campaign ID pasted in. */
  async function updateCampaigns() {
    const updatable = campaigns.filter((c) => c.status === "exported" && c.amazon_campaign_id);
    if (updatable.length === 0) {
      setNotice("No exported campaigns with an Amazon Campaign ID to update yet.");
      return;
    }
    setUpdatingCampaigns(true);
    setError(null);
    setNotice(null);
    try {
      let changed = 0;
      for (const c of updatable) {
        const res = await fetch(`/api/books/${bookId}/campaigns/${c.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        const body = await res.json().catch(() => ({}));
        if (res.ok) changed += body.changedCount ?? 0;
      }
      setNotice(`Updated ${updatable.length} campaign(s) — ${changed} row(s) changed.`);
      await loadCampaigns();
      onDataChanged();
    } finally {
      setUpdatingCampaigns(false);
    }
  }

  const exportable = campaigns.filter((c) => c.bulksheet_path);

  async function exportCampaigns() {
    if (exportable.length === 0) {
      setNotice("No campaign bulksheets to export yet — create or update a campaign first.");
      return;
    }
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns/export`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to export campaigns");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "campaigns-export.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export campaigns");
    }
  }

  const needsAmazonId = campaigns.filter((c) => c.status === "exported" && !c.amazon_campaign_id);

  return (
    <div className="mb-6">
      <div className="mb-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <button onClick={generateAll} disabled={generating || !metadataReady} className="action-card">
          <div className="flex items-start justify-between">
            <span className="icon-tile icon-tile-inverted">
              {generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
            </span>
          </div>
          <span className="text-md font-semibold">{generating ? "Generating…" : "Generate keywords/ASINs"}</span>
        </button>

        <button onClick={rerunFiltersAll} disabled={filtering} className="action-card action-card-secondary">
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              {filtering ? <Loader2 size={20} className="animate-spin" style={{ color: "var(--icon-active)" }} /> : <Filter size={20} style={{ color: "var(--icon-active)" }} />}
            </span>
          </div>
          <span className="text-md font-semibold">{filtering ? "Filtering…" : "Re-run filters"}</span>
        </button>

        <button onClick={addPresetsAll} disabled={applyingPresets} className="action-card action-card-secondary">
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              {applyingPresets ? <Loader2 size={20} className="animate-spin" style={{ color: "var(--icon-active)" }} /> : <ListChecks size={20} style={{ color: "var(--icon-active)" }} />}
            </span>
          </div>
          <span className="text-md font-semibold">{applyingPresets ? "Applying…" : "Add genre presets"}</span>
        </button>

        <button onClick={refreshMetadata} disabled={refreshingMeta} className="action-card action-card-secondary">
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              <RefreshCw size={20} className={refreshingMeta ? "animate-spin" : undefined} style={{ color: "var(--icon-active)" }} />
            </span>
          </div>
          <span className="text-md font-semibold">{refreshingMeta ? "Re-fetching…" : "Refresh metadata"}</span>
        </button>

        <button
          onClick={() => {
            setError(null);
            setNotice(null);
            setShowResultsUpload(true);
          }}
          className="action-card action-card-secondary"
          title="Upload an Amazon Search Term Report to feed Update Campaigns real performance data"
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              <Upload size={20} style={{ color: "var(--icon-active)" }} />
            </span>
          </div>
          <span className="text-md font-semibold">Upload results</span>
        </button>

        <button onClick={() => createCampaigns(false)} disabled={creatingCampaigns} className="action-card">
          <div className="flex items-start justify-between">
            <span className="icon-tile icon-tile-inverted">
              {creatingCampaigns ? <Loader2 size={20} className="animate-spin" /> : <Rocket size={20} />}
            </span>
          </div>
          <span className="text-md font-semibold">{creatingCampaigns ? "Creating…" : "Create campaigns"}</span>
        </button>

        <button
          onClick={updateCampaigns}
          disabled={updatingCampaigns || campaigns.every((c) => c.status !== "exported" || !c.amazon_campaign_id)}
          className="action-card action-card-secondary"
          title="Re-scores every exported campaign that has an Amazon Campaign ID against the current bank"
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              {updatingCampaigns ? <Loader2 size={20} className="animate-spin" style={{ color: "var(--icon-active)" }} /> : <RefreshCw size={20} style={{ color: "var(--icon-active)" }} />}
            </span>
          </div>
          <span className="text-md font-semibold">{updatingCampaigns ? "Updating…" : "Update campaigns"}</span>
        </button>

        <button
          onClick={exportCampaigns}
          disabled={exportable.length === 0}
          className="action-card action-card-secondary"
          title="Download the current bulksheet for every campaign that has one"
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              <Download size={20} style={{ color: "var(--icon-active)" }} />
            </span>
          </div>
          <span className="text-md font-semibold">Export campaigns</span>
        </button>
      </div>

      {needsAmazonId.length > 0 && (
        <div className="alert alert-warning mt-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">
            {needsAmazonId.length} campaign{needsAmazonId.length === 1 ? "" : "s"} still need{needsAmazonId.length === 1 ? "s" : ""} an Amazon
            Campaign ID pasted in below before it can be updated — see the campaign list in the keyword manager.
          </p>
        </div>
      )}

      {error && (
        <div className="alert alert-error mt-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
        </div>
      )}

      {notice && (
        <div className="alert alert-success mt-3" aria-live="polite">
          <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{notice}</p>
        </div>
      )}

      {showResultsUpload && (
        <ResultsUploadModal
          bookId={bookId}
          onClose={() => setShowResultsUpload(false)}
          onImported={() => {
            setNotice("Results imported — Update campaigns will now weigh real performance.");
            onDataChanged();
          }}
        />
      )}
    </div>
  );
}
