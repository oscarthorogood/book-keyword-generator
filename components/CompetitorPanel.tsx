"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Download,
  Filter,
  Loader2,
  Plus,
  Search,
  Swords,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type MatchType = "broad" | "phrase" | "exact";
type CompetitorKeywordStatus = "active" | "paused" | "negative" | "archived" | "rejected";

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  source: string;
  notes: string | null;
  created_at: string;
}

interface CompetitorKeywordRow {
  id: string;
  competitor_asin: string;
  text: string;
  volume: number;
  rank: number | null;
  competitor_count: number;
  mean_rank: number | null;
  category: string | null;
  intent_segment: string | null;
  match_type: MatchType;
  specificity: number | null;
  status: CompetitorKeywordStatus;
  bid: number | null;
  rejection_reason: string | null;
  rejected_by_filter: string | null;
}

interface ImportSummary {
  asinsSeen: number;
  rowsParsed: number;
  aggregatedCount: number;
  candidateCount: number;
  storedCount: number;
}

const SOURCES = ["manual", "kdpradar", "datadive", "helium10", "sellersprite"];
const TOOLS = ["helium10", "sellersprite", "kdpradar", "datadive"] as const;
const STATUSES: CompetitorKeywordStatus[] = ["active", "paused", "negative", "archived", "rejected"];
const PAGE_SIZE = 100;

const statusBadge: Record<CompetitorKeywordStatus, string> = {
  active: "badge-success",
  paused: "badge-warning",
  negative: "badge-error",
  archived: "badge-gray",
  rejected: "badge-gray",
};

const STATUS_LABELS: Record<CompetitorKeywordStatus, string> = {
  active: "Active",
  paused: "Paused",
  negative: "Negative",
  archived: "Archived",
  rejected: "Rejected",
};

const SPECIFICITY_LABELS: Record<number, string> = {
  1: "Broad",
  2: "Somewhat broad",
  3: "Medium",
  4: "Somewhat specific",
  5: "Very specific",
};

function labelForFilter(filter: string | null | undefined): string {
  if (!filter) return "";
  return filter.replace(/([A-Z])/g, " $1").toLowerCase();
}

async function fetchCompetitorAsins(bookId: string): Promise<CompetitorAsinRow[]> {
  const res = await fetch(`/api/books/${bookId}/competitors`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? (body.competitors ?? []) : [];
}

async function fetchCompetitorKeywords(bookId: string): Promise<CompetitorKeywordRow[]> {
  const res = await fetch(`/api/books/${bookId}/competitor-keywords`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? (body.keywords ?? []) : [];
}

/** Minimal CSV parser — handles quoted fields with embedded commas, no embedded newlines. */
function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (inQuotes) {
        if (char === '"' && line[i + 1] === '"') {
          current += '"';
          i++;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          current += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        fields.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current);
    return fields.map((f) => f.trim());
  }

  const headers = splitLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, i) => {
      row[header] = values[i] ?? "";
    });
    return row;
  });
}

/**
 * Competitor-ASIN + competitor-keyword panel (spec §6) — the mode="competitors"
 * half of BookKeywordPanel, laid out identically to KeywordManager: the same
 * "manager" header, action-card row (generate/re-run filters/export), status
 * tabs with counts, search + filters, and inline-editable table. The one
 * structural difference is the data being managed is ASINs and the
 * reverse-ASIN keywords they surface, not hand-picked keywords.
 */
export default function CompetitorPanel({ bookId }: { bookId: string }) {
  const [asins, setAsins] = useState<CompetitorAsinRow[]>([]);
  const [keywords, setKeywords] = useState<CompetitorKeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newAsinText, setNewAsinText] = useState("");
  const [newSource, setNewSource] = useState("manual");
  const [adding, setAdding] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"all" | CompetitorKeywordStatus>("all");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [matchTypeFilter, setMatchTypeFilter] = useState<"all" | string>("all");
  const [filterFilter, setFilterFilter] = useState<"all" | string>("all");
  const [specificityFilter, setSpecificityFilter] = useState<"all" | number>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [refiltering, setRefiltering] = useState(false);
  const [refilterResult, setRefilterResult] = useState<string | null>(null);

  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [importTool, setImportTool] = useState<(typeof TOOLS)[number]>("helium10");
  const [importAsin, setImportAsin] = useState("");
  const [importCsv, setImportCsv] = useState("");

  async function reload() {
    const [loadedAsins, loadedKeywords] = await Promise.all([
      fetchCompetitorAsins(bookId),
      fetchCompetitorKeywords(bookId),
    ]);
    setAsins(loadedAsins);
    setKeywords(loadedKeywords);
    setSelected(new Set());
  }

  useEffect(() => {
    let active = true;
    (async () => {
      const [loadedAsins, loadedKeywords] = await Promise.all([
        fetchCompetitorAsins(bookId),
        fetchCompetitorKeywords(bookId),
      ]);
      if (!active) return;
      setAsins(loadedAsins);
      setKeywords(loadedKeywords);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [bookId]);

  const selectedImportAsin = importAsin || asins[0]?.competitor_asin || "";

  async function addAsins() {
    const text = newAsinText.trim();
    if (!text) return;
    setAdding(true);
    setError(null);
    try {
      const values = text
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean);

      for (const value of values) {
        const res = await fetch(`/api/books/${bookId}/competitors`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ competitor_asin: value, source: newSource }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `Could not add ${value}.`);
        }
      }
      setNewAsinText("");
      await reload();
    } finally {
      setAdding(false);
    }
  }

  async function deleteAsin(id: string) {
    setAsins((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/books/${bookId}/competitors`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }

  async function updateKeyword(id: string, updates: Partial<CompetitorKeywordRow>) {
    setKeywords((prev) => prev.map((k) => (k.id === id ? { ...k, ...updates } : k)));

    const payload: Record<string, unknown> = {};
    if (updates.match_type !== undefined) payload.matchType = updates.match_type;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.bid !== undefined) payload.bid = updates.bid;

    await fetch(`/api/competitor-keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function deleteKeyword(id: string) {
    setKeywords((prev) => prev.filter((k) => k.id !== id));
    await fetch(`/api/competitor-keywords/${id}`, { method: "DELETE" });
  }

  async function bulkUpdate(status: CompetitorKeywordStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setKeywords((prev) => prev.map((k) => (selected.has(k.id) ? { ...k, status } : k)));
    setSelected(new Set());
    await fetch(`/api/books/${bookId}/competitor-keywords`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status }),
    });
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setKeywords((prev) => prev.filter((k) => !selected.has(k.id)));
    setSelected(new Set());
    await fetch(`/api/books/${bookId}/competitor-keywords`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  /**
   * "Generate" for competitors runs the existing reverse-ASIN import
   * pipeline (lib/reverseAsin.ts) over a pasted export for one competitor
   * ASIN, rather than a from-scratch discovery pass — there's no automatic
   * ASIN-discovery pipeline to run.
   */
  async function generateFromImport() {
    setGenerating(true);
    setGenerateError(null);
    setSummary(null);
    try {
      const parsed = parseCsv(importCsv);
      if (parsed.length === 0) {
        setGenerateError("Paste a CSV export with a header row and at least one data row.");
        return;
      }
      if (!selectedImportAsin) {
        setGenerateError("Add a competitor ASIN above and select it before importing.");
        return;
      }

      const res = await fetch(`/api/books/${bookId}/reverse-asin-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: importTool,
          rows: parsed.map((row) => ({ asin: selectedImportAsin, row })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError(body.error || "Could not import this export.");
        return;
      }
      setSummary(body as ImportSummary);
      setShowGenerateForm(false);
      setImportCsv("");
      await reload();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not import this export.");
    } finally {
      setGenerating(false);
    }
  }

  async function rerunFilters() {
    setRefiltering(true);
    setRefilterResult(null);
    try {
      const res = await fetch(`/api/books/${bookId}/competitor-keywords/filter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefilterResult(body.error || "Could not re-run the filters.");
        return;
      }
      setRefilterResult(
        `Re-checked ${body.examined} keyword${body.examined === 1 ? "" : "s"} · ${body.changed} changed`
      );
      await reload();
    } catch (err) {
      setRefilterResult(err instanceof Error ? err.message : "Could not re-run the filters.");
    } finally {
      setRefiltering(false);
    }
  }

  function changeFilters(apply: () => void) {
    apply();
    setVisibleCount(PAGE_SIZE);
    setSelected(new Set());
  }

  const categories = useMemo(
    () => Array.from(new Set(keywords.map((k) => k.category).filter((c): c is string => !!c))).sort(),
    [keywords]
  );
  const matchTypes = useMemo(() => Array.from(new Set(keywords.map((k) => k.match_type))).sort(), [keywords]);
  const rejectingFilters = useMemo(
    () => Array.from(new Set(keywords.map((k) => k.rejected_by_filter).filter((f): f is string => !!f))).sort(),
    [keywords]
  );

  const keptCount = useMemo(() => keywords.filter((k) => k.status !== "rejected").length, [keywords]);
  const rejectedCount = keywords.length - keptCount;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return keywords.filter((k) => {
      if (statusFilter === "all" && k.status === "rejected") return false;
      if (statusFilter !== "all" && k.status !== statusFilter) return false;
      if (categoryFilter !== "all" && k.category !== categoryFilter) return false;
      if (matchTypeFilter !== "all" && k.match_type !== matchTypeFilter) return false;
      if (filterFilter !== "all" && k.rejected_by_filter !== filterFilter) return false;
      if (specificityFilter !== "all" && k.specificity !== specificityFilter) return false;
      if (term && !k.text.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [keywords, statusFilter, search, categoryFilter, matchTypeFilter, filterFilter, specificityFilter]);

  const page = visible.slice(0, visibleCount);
  const allPageSelected = page.length > 0 && page.every((k) => selected.has(k.id));

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) page.forEach((k) => next.delete(k.id));
      else page.forEach((k) => next.add(k.id));
      return next;
    });
  }

  return (
    <section className="card">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="card-title">Competitor manager</p>
          <p className="meta-line mt-1">
            {keptCount} competitor keyword{keptCount === 1 ? "" : "s"} for this book
            {rejectedCount > 0 && ` · ${rejectedCount} rejected by the relevance filters`}
            {` · ${asins.length} competitor ASIN${asins.length === 1 ? "" : "s"} tracked`}
          </p>
        </div>
      </div>

      {/* Primary actions — same shape as KeywordManager's action-card row. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button
          onClick={() => setShowGenerateForm((open) => !open)}
          className="action-card"
          aria-expanded={showGenerateForm}
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile icon-tile-inverted">
              <Upload size={20} />
            </span>
            <Plus size={20} style={{ color: "rgba(255,255,255,0.6)" }} aria-hidden="true" />
          </div>
          <span className="text-md font-semibold">Generate keywords</span>
        </button>

        <button
          onClick={rerunFilters}
          disabled={refiltering || keywords.length === 0}
          className="action-card action-card-secondary"
          title="Re-check every competitor keyword against this book's relevance filters"
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              {refiltering ? (
                <Loader2 size={20} className="animate-spin" style={{ color: "var(--icon-active)" }} />
              ) : (
                <Filter size={20} style={{ color: "var(--icon-active)" }} />
              )}
            </span>
          </div>
          <span className="text-md font-semibold">{refiltering ? "Filtering…" : "Re-run filters"}</span>
        </button>

        <a
          href={`/api/books/${bookId}/competitor-keywords/export`}
          className="action-card action-card-secondary"
          title="Download an Amazon Ads bulk-upload CSV (competitor keywords, negatives and competitor ASIN targets)"
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              <Download size={20} style={{ color: "var(--icon-active)" }} />
            </span>
          </div>
          <span className="text-md font-semibold">Export bulksheet</span>
        </a>
      </div>

      {refilterResult && (
        <div className="alert mb-6" aria-live="polite">
          <Filter size={20} className="mt-0.5 shrink-0" style={{ color: "var(--icon-default)" }} />
          <p>{refilterResult}</p>
        </div>
      )}

      {error && (
        <div className="alert alert-error mb-4" role="alert">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {showGenerateForm && (
        <div className="card card-compact mb-6" style={{ background: "var(--bg-subtle)" }}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Generate from a reverse-ASIN export
              </p>
              <p className="meta-line mt-1 max-w-2xl">
                Paste a Cerebro/reverse-ASIN CSV export (Helium 10, SellerSprite, KDPRadar or DataDive) for one
                competitor ASIN. Rows are aggregated, classified and stored, then gated by this book&apos;s
                relevance filters just like generated keywords.
              </p>
            </div>
            <button
              onClick={() => setShowGenerateForm(false)}
              className="btn btn-tertiary btn-icon btn-sm"
              aria-label="Close generate panel"
            >
              <X size={20} />
            </button>
          </div>

          {asins.length === 0 && (
            <div className="alert alert-warning mb-4">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" />
              <p>Add a competitor ASIN below first — the import needs to know which ASIN this export came from.</p>
            </div>
          )}

          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <label className="field-label" htmlFor="import-asin">
                Competitor ASIN
              </label>
              <select
                id="import-asin"
                value={selectedImportAsin}
                onChange={(e) => setImportAsin(e.target.value)}
                className="input w-auto"
                disabled={asins.length === 0}
              >
                {asins.map((asin) => (
                  <option key={asin.id} value={asin.competitor_asin}>
                    {asin.competitor_asin}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="import-tool">
                Export tool
              </label>
              <select
                id="import-tool"
                value={importTool}
                onChange={(e) => setImportTool(e.target.value as (typeof TOOLS)[number])}
                className="input w-auto"
              >
                {TOOLS.map((tool) => (
                  <option key={tool} value={tool}>
                    {tool}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="field-label" htmlFor="import-csv">
            CSV export
          </label>
          <textarea
            id="import-csv"
            value={importCsv}
            onChange={(e) => setImportCsv(e.target.value)}
            rows={6}
            placeholder="Paste the export, including its header row"
            className="input resize-y font-mono text-xs"
          />

          {generateError && (
            <div className="alert alert-error mt-4" role="alert">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <p>{generateError}</p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button
              onClick={generateFromImport}
              disabled={generating || asins.length === 0 || !importCsv.trim()}
              className="btn btn-primary"
            >
              {generating ? <Loader2 size={20} className="animate-spin" /> : <Upload size={20} />}
              {generating ? "Importing…" : "Generate keywords"}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="alert alert-success mb-6" aria-live="polite">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="alert-title">
              Stored {summary.storedCount} competitor keyword{summary.storedCount === 1 ? "" : "s"}
            </p>
            <p className="mt-1">
              {summary.rowsParsed} rows parsed · {summary.aggregatedCount} aggregated · {summary.candidateCount}{" "}
              candidates from {summary.asinsSeen} ASIN{summary.asinsSeen === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}

      {/* Add competitor ASIN */}
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <textarea
          value={newAsinText}
          onChange={(e) => setNewAsinText(e.target.value)}
          placeholder="Add a competitor ASIN, or paste a list (one per line / comma separated)"
          rows={1}
          className="input min-w-[240px] flex-1 resize-none"
          aria-label="New competitor ASIN"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addAsins();
            }
          }}
        />
        <select value={newSource} onChange={(e) => setNewSource(e.target.value)} className="input w-auto" aria-label="Source">
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <button onClick={addAsins} disabled={adding || !newAsinText.trim()} className="btn btn-secondary">
          {adding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
          Add
        </button>
      </div>

      {asins.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {asins.map((asin) => (
            <span key={asin.id} className="chip-tag inline-flex items-center gap-2">
              {asin.competitor_asin}
              <span className="meta-line text-xs">({asin.source})</span>
              <button
                onClick={() => deleteAsin(asin.id)}
                aria-label={`Remove competitor ASIN ${asin.competitor_asin}`}
                title="Remove"
              >
                <Trash2 size={12} />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Status tabs — the primary cut through the list, matching KeywordManager. */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="tabs overflow-x-auto" role="tablist" aria-label="Filter by status">
          <button
            role="tab"
            aria-selected={statusFilter === "all"}
            onClick={() => changeFilters(() => setStatusFilter("all"))}
            className={`tab ${statusFilter === "all" ? "tab-active" : ""}`}
          >
            All ({keptCount})
          </button>
          {STATUSES.map((status) => (
            <button
              key={status}
              role="tab"
              aria-selected={statusFilter === status}
              onClick={() => changeFilters(() => setStatusFilter(status))}
              className={`tab ${statusFilter === status ? "tab-active" : ""}`}
            >
              {STATUS_LABELS[status]} ({keywords.filter((k) => k.status === status).length})
            </button>
          ))}
        </div>
      </div>

      {/* Search + secondary filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={20} className="input-icon" aria-hidden="true" />
          <label className="sr-only" htmlFor="competitor-keyword-search">
            Search competitor keywords
          </label>
          <input
            id="competitor-keyword-search"
            type="search"
            value={search}
            onChange={(e) => changeFilters(() => setSearch(e.target.value))}
            placeholder="Search competitor keywords"
            className="input input-with-icon"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => changeFilters(() => setCategoryFilter(e.target.value))}
          className="input w-auto"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category.replace(/-/g, " ")}
            </option>
          ))}
        </select>

        <select
          value={matchTypeFilter}
          onChange={(e) => changeFilters(() => setMatchTypeFilter(e.target.value))}
          className="input w-auto"
          aria-label="Filter by match type"
        >
          <option value="all">All match types</option>
          {matchTypes.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        {rejectingFilters.length > 0 && (
          <select
            value={filterFilter}
            onChange={(e) => changeFilters(() => setFilterFilter(e.target.value))}
            className="input w-auto"
            aria-label="Filter by rejecting filter"
          >
            <option value="all">Any filter verdict</option>
            {rejectingFilters.map((filter) => (
              <option key={filter} value={filter}>
                {labelForFilter(filter).trim()} ({keywords.filter((k) => k.rejected_by_filter === filter).length})
              </option>
            ))}
          </select>
        )}

        <select
          value={specificityFilter}
          onChange={(e) =>
            changeFilters(() => setSpecificityFilter(e.target.value === "all" ? "all" : Number(e.target.value)))
          }
          className="input w-auto"
          aria-label="Filter by specificity"
        >
          <option value="all">Any specificity</option>
          {[1, 2, 3, 4, 5].map((level) => (
            <option key={level} value={level}>
              {SPECIFICITY_LABELS[level]}
            </option>
          ))}
        </select>
      </div>

      {selected.size > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
          style={{ background: "var(--bg-subtle)", borderColor: "var(--line)" }}
        >
          <span className="mr-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {selected.size} selected
          </span>
          {STATUSES.filter((status) => status !== "rejected").map((status) => (
            <button key={status} onClick={() => bulkUpdate(status)} className="btn btn-secondary btn-sm">
              Mark {STATUS_LABELS[status].toLowerCase()}
            </button>
          ))}
          <button onClick={bulkDelete} className="btn btn-destructive btn-sm">
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}

      {loading ? (
        <div className="table-wrap" aria-busy="true" aria-label="Loading competitor keywords">
          {[0, 1, 2, 3].map((row) => (
            <div key={row} className="flex items-center gap-4 border-b p-4" style={{ borderColor: "var(--line)" }}>
              <div className="skeleton h-4 w-4 shrink-0" />
              <div className="skeleton h-4 flex-1" />
              <div className="skeleton h-4 w-20 shrink-0" />
            </div>
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <span className="icon-tile icon-tile-lg icon-tile-dark">
            <Swords size={24} />
          </span>
          <div className="space-y-1">
            <p className="empty-state-title">
              {keywords.length === 0 ? "No competitor keywords yet" : "No competitor keywords match these filters"}
            </p>
            <p className="empty-state-body">
              {keywords.length === 0
                ? "Add a competitor ASIN above, then generate from a reverse-ASIN export."
                : "Try a different status tab, or clear the search."}
            </p>
          </div>
          {keywords.length === 0 ? (
            <button onClick={() => setShowGenerateForm(true)} className="btn btn-primary">
              <Upload size={20} />
              Generate keywords
            </button>
          ) : (
            <button
              onClick={() =>
                changeFilters(() => {
                  setSearch("");
                  setStatusFilter("all");
                  setCategoryFilter("all");
                  setMatchTypeFilter("all");
                  setFilterFilter("all");
                  setSpecificityFilter("all");
                })
              }
              className="btn btn-secondary"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="table-wrap overflow-x-auto">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th scope="col" className="w-8">
                    <input
                      type="checkbox"
                      className="checkbox"
                      checked={allPageSelected}
                      onChange={toggleAllOnPage}
                      aria-label="Select all shown competitor keywords"
                    />
                  </th>
                  <th scope="col">Keyword</th>
                  <th scope="col">Match</th>
                  <th scope="col">Volume</th>
                  <th scope="col">Rank</th>
                  <th scope="col" className="hidden lg:table-cell">
                    Competitor ASINs
                  </th>
                  <th scope="col" className="hidden xl:table-cell">
                    Category
                  </th>
                  <th scope="col" className="hidden xl:table-cell">
                    Filter verdict
                  </th>
                  <th scope="col">Bid</th>
                  <th scope="col">Status</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.map((keyword) => (
                  <tr key={keyword.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selected.has(keyword.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(keyword.id);
                            else next.delete(keyword.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${keyword.text}`}
                      />
                    </td>
                    <td>
                      <p className="cell-primary">{keyword.text}</p>
                    </td>
                    <td>
                      <select
                        value={keyword.match_type}
                        onChange={(e) => updateKeyword(keyword.id, { match_type: e.target.value as MatchType })}
                        className="input input-sm w-auto"
                        aria-label={`Match type for ${keyword.text}`}
                      >
                        <option value="broad">Broad</option>
                        <option value="phrase">Phrase</option>
                        <option value="exact">Exact</option>
                      </select>
                    </td>
                    <td>{keyword.volume}</td>
                    <td>{keyword.rank ?? "—"}</td>
                    <td className="hidden lg:table-cell">
                      {keyword.competitor_count}
                      {keyword.mean_rank !== null && (
                        <span className="meta-line text-xs"> · mean rank {keyword.mean_rank}</span>
                      )}
                    </td>
                    <td className="hidden xl:table-cell">{keyword.category?.replace(/-/g, " ") ?? "—"}</td>
                    <td className="hidden xl:table-cell">
                      {keyword.rejected_by_filter ? (
                        <span title={keyword.rejection_reason ?? undefined}>
                          <span className="cell-primary">{labelForFilter(keyword.rejected_by_filter).trim()}</span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-placeholder)" }}>—</span>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={keyword.bid ?? ""}
                        onChange={(e) =>
                          updateKeyword(keyword.id, {
                            bid: e.target.value === "" ? null : parseFloat(e.target.value),
                          })
                        }
                        placeholder="—"
                        className="input input-sm w-20"
                        aria-label={`Bid for ${keyword.text}`}
                      />
                    </td>
                    <td>
                      <select
                        value={keyword.status}
                        onChange={(e) => updateKeyword(keyword.id, { status: e.target.value as CompetitorKeywordStatus })}
                        className={`badge ${statusBadge[keyword.status]} cursor-pointer appearance-none pr-3`}
                        aria-label={`Status for ${keyword.text}`}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        {keyword.status === "rejected" && (
                          <button
                            onClick={() => updateKeyword(keyword.id, { status: "active" })}
                            className="btn btn-tertiary btn-icon btn-sm"
                            aria-label={`Restore ${keyword.text}`}
                            title="False positive? Restore"
                          >
                            <CheckCircle2 size={16} style={{ color: "var(--icon-default)" }} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteKeyword(keyword.id)}
                          className="btn btn-tertiary btn-icon btn-sm"
                          aria-label={`Delete ${keyword.text}`}
                          title="Delete keyword"
                        >
                          <Trash2 size={16} style={{ color: "var(--icon-default)" }} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between gap-4">
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
              Showing {page.length} of {visible.length}
            </p>
            {page.length < visible.length && (
              <button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn btn-secondary">
                Show more
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
