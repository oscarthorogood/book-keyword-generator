"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  Filter,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Swords,
  Trash2,
} from "lucide-react";

type CompetitorAsinStatus = "active" | "paused" | "negative" | "archived" | "rejected";
type CompetitorAsinSource = "manual" | "kdpradar" | "datadive" | "helium10" | "sellersprite" | "auto-crawl";

interface CompetitorAsinRow {
  id: string;
  competitor_asin: string;
  source: CompetitorAsinSource;
  notes: string | null;
  status: CompetitorAsinStatus;
  bid: number | null;
  rejection_reason: string | null;
  rejected_by_filter: string | null;
  created_at: string;
}

interface GenerateSummary {
  candidateCount: number;
  insertedCount: number;
}

const SOURCES: CompetitorAsinSource[] = ["manual", "kdpradar", "datadive", "helium10", "sellersprite", "auto-crawl"];
const STATUSES: CompetitorAsinStatus[] = ["active", "paused", "negative", "archived", "rejected"];
const PAGE_SIZE = 100;

const statusBadge: Record<CompetitorAsinStatus, string> = {
  active: "badge-success",
  paused: "badge-warning",
  negative: "badge-error",
  archived: "badge-gray",
  rejected: "badge-gray",
};

const STATUS_LABELS: Record<CompetitorAsinStatus, string> = {
  active: "Active",
  paused: "Paused",
  negative: "Negative",
  archived: "Archived",
  rejected: "Rejected",
};

function labelForSource(source: string | null): string {
  if (!source) return "—";
  return source.replace(/-/g, " ");
}

function labelForFilter(filter: string | null | undefined): string {
  if (!filter) return "";
  return filter.replace(/([A-Z])/g, " $1").toLowerCase();
}

async function fetchCompetitorAsins(bookId: string): Promise<CompetitorAsinRow[]> {
  const res = await fetch(`/api/books/${bookId}/competitors`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? (body.competitors ?? []) : [];
}

/**
 * Competitor-ASIN manager (spec §6) — the mode="competitors" half of
 * BookKeywordPanel. Managed exactly the same way as KeywordManager, with
 * competitor ASINs standing in for keywords: same manager header, action
 * cards (generate/re-run filters/export), status tabs, search + filters,
 * bulk toolbar, and inline-editable table. There is no competitor-keyword
 * concept here — this tab tracks ASINs only.
 */
export default function CompetitorPanel({ bookId }: { bookId: string }) {
  const [asins, setAsins] = useState<CompetitorAsinRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newAsinText, setNewAsinText] = useState("");
  const [newSource, setNewSource] = useState<CompetitorAsinSource>("manual");
  const [adding, setAdding] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"all" | CompetitorAsinStatus>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [filterFilter, setFilterFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenerateSummary | null>(null);

  const [refiltering, setRefiltering] = useState(false);
  const [refilterResult, setRefilterResult] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchCompetitorAsins(bookId)
      .then((rows) => {
        if (!active) return;
        setAsins(rows);
        setLoading(false);
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  async function reload() {
    setAsins(await fetchCompetitorAsins(bookId));
    setSelected(new Set());
  }

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

  async function updateAsin(id: string, updates: Partial<CompetitorAsinRow>) {
    setAsins((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));

    const payload: Record<string, unknown> = {};
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.bid !== undefined) payload.bid = updates.bid;

    await fetch(`/api/competitors/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  }

  async function deleteAsin(id: string) {
    setAsins((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/competitors/${id}`, { method: "DELETE" });
  }

  async function bulkUpdate(status: CompetitorAsinStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setAsins((prev) => prev.map((a) => (selected.has(a.id) ? { ...a, status } : a)));
    setSelected(new Set());
    await fetch(`/api/books/${bookId}/competitors`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status }),
    });
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setAsins((prev) => prev.filter((a) => !selected.has(a.id)));
    setSelected(new Set());
    await fetch(`/api/books/${bookId}/competitors`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  /** Pulls competitor ASINs from the same metadata crawl keyword generation uses (§ generate route). */
  async function generateAsins() {
    setGenerating(true);
    setGenerateError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/books/${bookId}/competitors/generate`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError(body.error || "Could not generate competitor ASINs.");
        return;
      }
      setSummary(body as GenerateSummary);
      await reload();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not generate competitor ASINs.");
    } finally {
      setGenerating(false);
    }
  }

  async function rerunFilters() {
    setRefiltering(true);
    setRefilterResult(null);
    try {
      const res = await fetch(`/api/books/${bookId}/competitors/filter`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRefilterResult(body.error || "Could not re-run the filters.");
        return;
      }
      setRefilterResult(
        `Re-checked ${body.examined} competitor ASIN${body.examined === 1 ? "" : "s"} · ${body.changed} changed`
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

  const sources = useMemo(() => Array.from(new Set(asins.map((a) => a.source))).sort(), [asins]);
  const rejectingFilters = useMemo(
    () => Array.from(new Set(asins.map((a) => a.rejected_by_filter).filter((f): f is string => !!f))).sort(),
    [asins]
  );

  const keptCount = useMemo(() => asins.filter((a) => a.status !== "rejected").length, [asins]);
  const rejectedCount = asins.length - keptCount;

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return asins.filter((a) => {
      if (statusFilter === "all" && a.status === "rejected") return false;
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (sourceFilter !== "all" && a.source !== sourceFilter) return false;
      if (filterFilter !== "all" && a.rejected_by_filter !== filterFilter) return false;
      if (term && !a.competitor_asin.toLowerCase().includes(term) && !a.notes?.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [asins, statusFilter, sourceFilter, filterFilter, search]);

  const page = visible.slice(0, visibleCount);
  const allPageSelected = page.length > 0 && page.every((a) => selected.has(a.id));

  function toggleAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) page.forEach((a) => next.delete(a.id));
      else page.forEach((a) => next.add(a.id));
      return next;
    });
  }

  return (
    <section className="card">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="card-title">Competitor manager</p>
          <p className="meta-line mt-1">
            {keptCount} competitor ASIN{keptCount === 1 ? "" : "s"} for this book
            {rejectedCount > 0 && ` · ${rejectedCount} rejected by the relevance filters`}
          </p>
        </div>
      </div>

      {/* Primary actions — same shape as KeywordManager's action-card row. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button onClick={generateAsins} disabled={generating} className="action-card">
          <div className="flex items-start justify-between">
            <span className="icon-tile icon-tile-inverted">
              {generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
            </span>
            <Plus size={20} style={{ color: "rgba(255,255,255,0.6)" }} aria-hidden="true" />
          </div>
          <span className="text-md font-semibold">{generating ? "Generating…" : "Generate ASINs"}</span>
        </button>

        <button
          onClick={rerunFilters}
          disabled={refiltering || asins.length === 0}
          className="action-card action-card-secondary"
          title="Re-check every competitor ASIN against this book's own ASIN and basic ASIN shape"
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
          href={`/api/books/${bookId}/competitors/export`}
          className="action-card action-card-secondary"
          title="Download an Amazon Ads bulk-upload CSV of competitor ASIN product targets"
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile">
              <Download size={20} style={{ color: "var(--icon-active)" }} />
            </span>
          </div>
          <span className="text-md font-semibold">Export bulksheet</span>
        </a>
      </div>

      {generateError && (
        <div className="alert alert-error mb-4" role="alert">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p>{generateError}</p>
        </div>
      )}

      {summary && (
        <div
          className={`alert mb-6 ${summary.insertedCount > 0 ? "alert-success" : "alert-warning"}`}
          aria-live="polite"
        >
          {summary.insertedCount > 0 ? (
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={20} className="mt-0.5 shrink-0" />
          )}
          <p>
            {summary.insertedCount > 0
              ? `Added ${summary.insertedCount} new competitor ASIN${summary.insertedCount === 1 ? "" : "s"} from ${summary.candidateCount} found in this book's competitor crawl.`
              : summary.candidateCount === 0
              ? "No competitor ASINs were found in this book's cached crawl. Try clicking 'Re-fetch metadata' at the top of the page, or add ASINs manually below."
              : `All ${summary.candidateCount} competitor ASINs found in the crawl are already tracked for this book.`}
          </p>
        </div>
      )}

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

      {/* Add competitor ASIN */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
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
        <select
          value={newSource}
          onChange={(e) => setNewSource(e.target.value as CompetitorAsinSource)}
          className="input w-auto"
          aria-label="Source for new competitor ASIN"
        >
          {SOURCES.filter((source) => source !== "auto-crawl").map((source) => (
            <option key={source} value={source}>
              {labelForSource(source)}
            </option>
          ))}
        </select>
        <button onClick={addAsins} disabled={adding || !newAsinText.trim()} className="btn btn-secondary">
          {adding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
          Add
        </button>
      </div>

      {/* Status tabs — the primary cut through the list (mirrors KeywordManager). */}
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
              {STATUS_LABELS[status]} ({asins.filter((a) => a.status === status).length})
            </button>
          ))}
        </div>
      </div>

      {/* Search + secondary filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <Search size={20} className="input-icon" aria-hidden="true" />
          <label className="sr-only" htmlFor="competitor-asin-search">
            Search competitor ASINs
          </label>
          <input
            id="competitor-asin-search"
            type="search"
            value={search}
            onChange={(e) => changeFilters(() => setSearch(e.target.value))}
            placeholder="Search competitor ASINs"
            className="input input-with-icon"
          />
        </div>

        <select
          value={sourceFilter}
          onChange={(e) => changeFilters(() => setSourceFilter(e.target.value))}
          className="input w-auto"
          aria-label="Filter by source"
        >
          <option value="all">All sources</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {labelForSource(source)}
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
                {labelForFilter(filter).trim()} ({asins.filter((a) => a.rejected_by_filter === filter).length})
              </option>
            ))}
          </select>
        )}
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
        <div className="table-wrap" aria-busy="true" aria-label="Loading competitor ASINs">
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
              {asins.length === 0 ? "No competitor ASINs yet" : "No competitor ASINs match these filters"}
            </p>
            <p className="empty-state-body">
              {asins.length === 0
                ? "Generate them from this book's competitor crawl, or add your own above."
                : "Try a different status tab, or clear the search."}
            </p>
          </div>
          {asins.length === 0 ? (
            <button onClick={generateAsins} disabled={generating} className="btn btn-primary">
              {generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
              Generate ASINs
            </button>
          ) : (
            <button
              onClick={() =>
                changeFilters(() => {
                  setSearch("");
                  setStatusFilter("all");
                  setSourceFilter("all");
                  setFilterFilter("all");
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
                      aria-label="Select all shown competitor ASINs"
                    />
                  </th>
                  <th scope="col">Competitor ASIN</th>
                  <th scope="col" className="hidden lg:table-cell">
                    Source
                  </th>
                  <th scope="col" className="hidden lg:table-cell">
                    Notes
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
                {page.map((asin) => (
                  <tr key={asin.id}>
                    <td>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={selected.has(asin.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(asin.id);
                            else next.delete(asin.id);
                            return next;
                          })
                        }
                        aria-label={`Select ${asin.competitor_asin}`}
                      />
                    </td>
                    <td>
                      <p className="cell-primary">{asin.competitor_asin}</p>
                    </td>
                    <td className="hidden lg:table-cell">{labelForSource(asin.source)}</td>
                    <td className="hidden lg:table-cell">
                      <span className="meta-line text-xs">{asin.notes ?? "—"}</span>
                    </td>
                    <td className="hidden xl:table-cell">
                      {asin.rejected_by_filter ? (
                        <span title={asin.rejection_reason ?? undefined}>
                          <span className="cell-primary">{labelForFilter(asin.rejected_by_filter).trim()}</span>
                          {asin.rejection_reason && (
                            <span className="meta-line block text-xs">{asin.rejection_reason}</span>
                          )}
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
                        value={asin.bid ?? ""}
                        onChange={(e) =>
                          updateAsin(asin.id, {
                            bid: e.target.value === "" ? null : parseFloat(e.target.value),
                          })
                        }
                        placeholder="—"
                        className="input input-sm w-20"
                        aria-label={`Bid for ${asin.competitor_asin}`}
                      />
                    </td>
                    <td>
                      <select
                        value={asin.status}
                        onChange={(e) => updateAsin(asin.id, { status: e.target.value as CompetitorAsinStatus })}
                        className={`badge ${statusBadge[asin.status]} cursor-pointer appearance-none pr-3`}
                        aria-label={`Status for ${asin.competitor_asin}`}
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
                        {asin.status === "rejected" && (
                          <button
                            onClick={() => updateAsin(asin.id, { status: "active" })}
                            className="btn btn-tertiary btn-icon btn-sm"
                            aria-label={`Restore ${asin.competitor_asin}`}
                            title="False positive? Restore"
                          >
                            <CheckCircle2 size={16} style={{ color: "var(--icon-default)" }} />
                          </button>
                        )}
                        <button
                          onClick={() => deleteAsin(asin.id)}
                          className="btn btn-tertiary btn-icon btn-sm"
                          aria-label={`Delete ${asin.competitor_asin}`}
                          title="Delete competitor ASIN"
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
