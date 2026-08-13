"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Download,
  Edit3,
  Filter,
  ListChecks,
  ListPlus,
  Loader2,
  Megaphone,
  Rocket,
  RefreshCw,
  Sparkles,
  Upload,
} from "lucide-react";
import ResultsUploadModal from "./ResultsUploadModal";

interface MenuItem {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}

/** A single button that fans out into a small menu of related actions (spec: group book-page buttons by function). */
function ActionMenu({ label, icon, items, primary }: { label: string; icon: ReactNode; items: MenuItem[]; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`action-card ${primary ? "" : "action-card-secondary"} w-full`}
      >
        <div className="flex items-center justify-between">
          <span className={`icon-tile ${primary ? "icon-tile-inverted" : ""}`}>{icon}</span>
          <ChevronDown size={18} className={`transition-transform ${open ? "rotate-180" : ""}`} style={{ color: primary ? undefined : "var(--icon-active)" }} />
        </div>
        <span className="text-md font-semibold">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-2 w-64 overflow-hidden rounded-md border bg-white shadow-lg"
          style={{ borderColor: "var(--line)" }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface Campaign {
  id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  status: string;
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

  /** Re-scores and re-uploads every already-exported campaign. */
  async function updateCampaigns() {
    const updatable = campaigns.filter((c) => c.status === "exported");
    if (updatable.length === 0) {
      setNotice("No exported campaigns to update yet.");
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

  function focusManualAdd() {
    const el = document.getElementById("manual-keyword-input");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    (el as HTMLTextAreaElement | null)?.focus();
  }

  return (
    <div className="mb-6">
      {/* Buttons grouped by function into dropdown menus (spec: simplify book page). */}
      <div className="mb-2 grid gap-3 sm:grid-cols-3">
        <ActionMenu
          label="Add Keywords/ASINs"
          icon={generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
          primary
          items={[
            { key: "generate", label: generating ? "Generating…" : "Generate", icon: <Sparkles size={16} />, onClick: generateAll, disabled: generating || !metadataReady },
            { key: "manual", label: "Manual", icon: <Edit3 size={16} />, onClick: focusManualAdd },
            { key: "presets", label: applyingPresets ? "Applying…" : "Genre Presets", icon: <ListChecks size={16} />, onClick: addPresetsAll, disabled: applyingPresets },
          ]}
        />

        <ActionMenu
          label="Campaigns"
          icon={<Megaphone size={20} style={{ color: "var(--icon-active)" }} />}
          items={[
            { key: "create", label: creatingCampaigns ? "Creating…" : "Create Campaigns", icon: <Rocket size={16} />, onClick: () => createCampaigns(false), disabled: creatingCampaigns },
            {
              key: "update",
              label: updatingCampaigns ? "Updating…" : "Update Campaigns",
              icon: <RefreshCw size={16} />,
              onClick: updateCampaigns,
              disabled: updatingCampaigns || campaigns.every((c) => c.status !== "exported"),
              title: "Re-scores every exported campaign against the current bank",
            },
            {
              key: "export",
              label: "Export Campaigns",
              icon: <Download size={16} />,
              onClick: exportCampaigns,
              disabled: exportable.length === 0,
              title: "Download the current bulksheet for every campaign that has one",
            },
            {
              key: "upload",
              label: "Upload Results",
              icon: <Upload size={16} />,
              onClick: () => {
                setError(null);
                setNotice(null);
                setShowResultsUpload(true);
              },
              title: "Upload an Amazon Search Term Report to feed Update Campaigns real performance data",
            },
          ]}
        />

        <ActionMenu
          label="Organise"
          icon={<ListPlus size={20} style={{ color: "var(--icon-active)" }} />}
          items={[
            { key: "filters", label: filtering ? "Filtering…" : "Run Filters", icon: <Filter size={16} />, onClick: rerunFiltersAll, disabled: filtering },
            { key: "refresh", label: refreshingMeta ? "Re-fetching…" : "Refresh Metadata", icon: <RefreshCw size={16} />, onClick: refreshMetadata, disabled: refreshingMeta },
          ]}
        />
      </div>

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
