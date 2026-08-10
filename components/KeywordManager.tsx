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
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

type MatchType = "broad" | "phrase" | "exact";
type KeywordStatus = "active" | "paused" | "negative" | "archived" | "rejected";

interface Keyword {
  id: string;
  text: string;
  match_type: MatchType;
  category: string | null;
  status: KeywordStatus;
  bid: number | null;
  source: string | null;
  created_at: string;
  /** Why the filter pipeline rejected or paused this keyword (lib/keywordFilters.ts). */
  rejection_reason?: string | null;
  /** Which filter decided — uiPollution, offTopicEntity, anchorRelevance, … */
  rejected_by_filter?: string | null;
}

interface GenerateSummary {
  insertedCount: number;
  alreadyPresentCount: number;
  generatedCount: number;
  contributingSources: string[];
  byMatchType: Record<string, number>;
  aiRanked: boolean;
  pausedCount?: number;
  rejectedCount?: number;
  negativeCount?: number;
  filterSummary?: {
    byVerdict: Record<string, number>;
    byFilter: Record<string, number>;
  };
  /** True when the database predates sql/08 and only the active keywords could be stored. */
  needsFilterMigration?: boolean;
}

interface KeywordManagerProps {
  bookId: string;
  metadataCapturedAt?: string;
  metadataReady: boolean;
  genreTerms: string[];
  onKeywordsChanged?: () => void;
}

const STATUSES: KeywordStatus[] = ["active", "paused", "negative", "archived", "rejected"];
const PAGE_SIZE = 100;

/** Status → badge recipe (§4.6). Every one of these is a token pairing. */
const statusBadge: Record<KeywordStatus, string> = {
  active: "badge-success",
  paused: "badge-warning",
  negative: "badge-error",
  archived: "badge-gray",
  rejected: "badge-gray",
};

const STATUS_LABELS: Record<KeywordStatus, string> = {
  active: "Active",
  paused: "Paused",
  negative: "Negative",
  archived: "Archived",
  rejected: "Rejected",
};

/** Filter names are camelCase in the pipeline; show them as words. */
function labelForFilter(filter: string | null | undefined): string {
  if (!filter) return "";
  return filter.replace(/([A-Z])/g, " $1").toLowerCase();
}

/** Fetches without touching state, so effects never set state synchronously. */
async function fetchKeywords(bookId: string): Promise<Keyword[]> {
  const res = await fetch(`/api/books/${bookId}/keywords`);
  const body = await res.json().catch(() => ({}));
  return res.ok ? (body.keywords ?? []) : [];
}

function labelForSource(source: string | null): string {
  if (!source) return "—";
  return source.replace(/-/g, " ");
}

export default function KeywordManager({
  bookId,
  metadataCapturedAt,
  metadataReady,
  genreTerms,
  onKeywordsChanged,
}: KeywordManagerProps) {
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [loading, setLoading] = useState(true);
  const [newText, setNewText] = useState("");
  const [newMatchType, setNewMatchType] = useState<MatchType>("phrase");
  const [adding, setAdding] = useState(false);

  const [statusFilter, setStatusFilter] = useState<"all" | KeywordStatus>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [filterFilter, setFilterFilter] = useState<"all" | string>("all");
  const [refiltering, setRefiltering] = useState(false);
  const [refilterResult, setRefilterResult] = useState<string | null>(null);

  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenerateSummary | null>(null);
  const [keyTropes, setKeyTropes] = useState("");

  useEffect(() => {
    let active = true;
    fetchKeywords(bookId)
      .then((rows) => {
        if (!active) return;
        setKeywords(rows);
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
    setKeywords(await fetchKeywords(bookId));
    setSelected(new Set());
    onKeywordsChanged?.();
  }

  async function addKeyword() {
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    try {
      // Supports pasting a list, one per line or comma separated.
      const entries = text
        .split(/[\n,]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .map((t) => ({ text: t, matchType: newMatchType }));

      const res = await fetch(`/api/books/${bookId}/keywords`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries.length > 1 ? { keywords: entries } : entries[0]),
      });
      if (res.ok) {
        setNewText("");
        await reload();
      }
    } finally {
      setAdding(false);
    }
  }

  /**
   * Optimistic edit of one keyword. The row uses snake_case columns while the
   * PATCH endpoint takes camelCase, so the local patch and the request body
   * are built separately rather than sending a union of both spellings.
   */
  async function updateKeyword(id: string, updates: Partial<Keyword>) {
    setKeywords((prev) => prev.map((k) => (k.id === id ? { ...k, ...updates } : k)));

    const payload: Record<string, unknown> = {};
    if (updates.match_type !== undefined) payload.matchType = updates.match_type;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.bid !== undefined) payload.bid = updates.bid;
    if (updates.text !== undefined) payload.text = updates.text;

    await fetch(`/api/keywords/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    onKeywordsChanged?.();
  }

  async function deleteKeyword(id: string) {
    setKeywords((prev) => prev.filter((k) => k.id !== id));
    await fetch(`/api/keywords/${id}`, { method: "DELETE" });
    onKeywordsChanged?.();
  }

  async function bulkUpdate(status: KeywordStatus) {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setKeywords((prev) => prev.map((k) => (selected.has(k.id) ? { ...k, status } : k)));
    setSelected(new Set());
    await fetch(`/api/books/${bookId}/keywords`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, status }),
    });
    onKeywordsChanged?.();
  }

  async function bulkDelete() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setKeywords((prev) => prev.filter((k) => !selected.has(k.id)));
    setSelected(new Set());
    await fetch(`/api/books/${bookId}/keywords`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    onKeywordsChanged?.();
  }

  async function generateKeywords() {
    setGenerating(true);
    setGenerateError(null);
    setSummary(null);
    try {
      const res = await fetch(`/api/books/${bookId}/keywords/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyTropes: keyTropes
            .split(/[\n,]/)
            .map((t) => t.trim())
            .filter(Boolean),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setGenerateError(body.error || "Could not generate keywords.");
        return;
      }
      setSummary(body as GenerateSummary);
      setShowGenerateForm(false);
      setKeyTropes("");
      await reload();
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : "Could not generate keywords.");
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Re-runs the filter pipeline over the keywords this book already has —
   * the migration path for lists generated before the pipeline existed, and
   * the way to re-apply it after tuning.
   */
  async function rerunFilters() {
    setRefiltering(true);
    setRefilterResult(null);
    try {
      const res = await fetch(`/api/books/${bookId}/keywords/filter`, {
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

  const sources = useMemo(
    () => Array.from(new Set(keywords.map((k) => k.source).filter((s): s is string => !!s))).sort(),
    [keywords]
  );

  // Rejections are research exhaust, not part of the working list — they get
  // their own tab rather than padding every count in the UI.
  const keptCount = useMemo(() => keywords.filter((k) => k.status !== "rejected").length, [keywords]);
  const rejectedCount = keywords.length - keptCount;

  const rejectingFilters = useMemo(
    () =>
      Array.from(
        new Set(keywords.map((k) => k.rejected_by_filter).filter((f): f is string => !!f))
      ).sort(),
    [keywords]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return keywords.filter((k) => {
      // A generate run produces more rejections than keepers, so the default
      // view is the list you'd actually work with; rejected has its own tab.
      if (statusFilter === "all" && k.status === "rejected") return false;
      if (statusFilter !== "all" && k.status !== statusFilter) return false;
      if (sourceFilter !== "all" && k.source !== sourceFilter) return false;
      if (filterFilter !== "all" && k.rejected_by_filter !== filterFilter) return false;
      if (term && !k.text.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [keywords, statusFilter, sourceFilter, filterFilter, search]);

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
          <p className="card-title">Keyword manager</p>
          <p className="meta-line mt-1">
            {keptCount} keyword{keptCount === 1 ? "" : "s"} for this book
            {rejectedCount > 0 && ` · ${rejectedCount} rejected by the relevance filters`}
            {metadataCapturedAt ? " · generated from the metadata captured when the book was added" : ""}
          </p>
        </div>
      </div>

      {/* Primary actions, as the reference screens' action-card row. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <button
          onClick={() => setShowGenerateForm((open) => !open)}
          className="action-card"
          aria-expanded={showGenerateForm}
        >
          <div className="flex items-start justify-between">
            <span className="icon-tile icon-tile-inverted">
              <Sparkles size={20} />
            </span>
            <Plus size={20} style={{ color: "rgba(255,255,255,0.6)" }} aria-hidden="true" />
          </div>
          <span className="text-md font-semibold">Generate keywords</span>
        </button>

        <button
          onClick={rerunFilters}
          disabled={refiltering || keywords.length === 0}
          className="action-card action-card-secondary"
          title="Re-check every keyword against this book's relevance filters"
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
          href={`/api/books/${bookId}/keywords/export`}
          className="action-card action-card-secondary"
          title="Download an Amazon Ads bulk-upload CSV (keywords, negatives and ASIN/brand targets)"
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

      {showGenerateForm && (
        <div className="card card-compact mb-6" style={{ background: "var(--bg-subtle)" }}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                Generate from this book&apos;s metadata
              </p>
              <p className="meta-line mt-1 max-w-2xl">
                Runs the stored ASIN scrape — categories, comparable titles, reviews, Q&amp;A, author
                catalogue, Goodreads/Open Library/Google Books — through every keyword source, plus live
                autocomplete and SerpApi sweeps. Everything is then gated by this book&apos;s relevance
                filters before anything is activated.
              </p>
              {genreTerms.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {genreTerms.slice(0, 6).map((term) => (
                    <span key={term} className="chip-tag">
                      {term}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              onClick={() => setShowGenerateForm(false)}
              className="btn btn-tertiary btn-icon btn-sm"
              aria-label="Close generate panel"
            >
              <X size={20} />
            </button>
          </div>

          {!metadataReady && (
            <div className="alert alert-warning mb-4">
              <AlertTriangle size={20} className="mt-0.5 shrink-0" />
              <p>
                This book&apos;s metadata is incomplete. Re-fetch it above before generating, or the keywords
                won&apos;t reflect the book.
              </p>
            </div>
          )}

          <label className="field-label" htmlFor="key-tropes">
            Key tropes or themes <span style={{ color: "var(--text-tertiary)" }}>(optional)</span>
          </label>
          <textarea
            id="key-tropes"
            value={keyTropes}
            onChange={(e) => setKeyTropes(e.target.value)}
            rows={2}
            placeholder="e.g. enemies to lovers, small town, locked room mystery"
            className="input resize-none"
            aria-describedby="key-tropes-hint"
          />
          <span className="field-hint" id="key-tropes-hint">
            One per line or comma separated. These are the highest-trust signal in the run — they seed the
            trope categories and anchor relevance.
          </span>

          {generateError && (
            <div className="alert alert-error mt-4" role="alert">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <p>{generateError}</p>
            </div>
          )}

          <div className="mt-5 flex justify-end">
            <button onClick={generateKeywords} disabled={generating || !metadataReady} className="btn btn-primary">
              {generating ? <Loader2 size={20} className="animate-spin" /> : <Sparkles size={20} />}
              {generating ? "Generating…" : "Generate keywords"}
            </button>
          </div>
        </div>
      )}

      {summary && (
        <div className="alert alert-success mb-6" aria-live="polite">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="alert-title">
              Added {summary.insertedCount} new keyword{summary.insertedCount === 1 ? "" : "s"}
              {summary.alreadyPresentCount > 0 && ` · ${summary.alreadyPresentCount} already in the list`}
            </p>
            <p className="mt-1">
              {summary.contributingSources.length} sources contributed
              {summary.byMatchType &&
                ` · ${Object.entries(summary.byMatchType)
                  .map(([type, count]) => `${count} ${type}`)
                  .join(", ")}`}
              {summary.aiRanked && " · AI relevance pass applied"}
            </p>
            {summary.needsFilterMigration && (
              <p className="mt-1" style={{ color: "var(--color-error-700)" }}>
                Rejected and paused keywords could not be stored — apply{" "}
                <code className="font-mono">sql/08-keyword-filter-status.sql</code> to this database to keep
                them.
              </p>
            )}
            {summary.filterSummary && (
              <p className="mt-1">
                Relevance filters: {summary.filterSummary.byVerdict.pass ?? 0} kept ·{" "}
                {summary.filterSummary.byVerdict.pause ?? 0} paused ·{" "}
                {summary.filterSummary.byVerdict.reject ?? 0} rejected
                {summary.negativeCount ? ` · ${summary.negativeCount} negatives added` : ""}
                {Object.keys(summary.filterSummary.byFilter).length > 0 &&
                  ` — ${Object.entries(summary.filterSummary.byFilter)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([filter, count]) => `${count} ${labelForFilter(filter).trim()}`)
                    .join(", ")}`}
              </p>
            )}
            <p className="mt-1">{summary.contributingSources.map(labelForSource).join(", ")}</p>
          </div>
        </div>
      )}

      {/* Add keyword */}
      <div className="mb-5 flex flex-wrap items-start gap-3">
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a keyword, or paste a list (one per line / comma separated)"
          rows={1}
          className="input min-w-[240px] flex-1 resize-none"
          aria-label="New keyword"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              addKeyword();
            }
          }}
        />
        <select
          value={newMatchType}
          onChange={(e) => setNewMatchType(e.target.value as MatchType)}
          className="input w-auto"
          aria-label="Match type for new keyword"
        >
          <option value="broad">Broad</option>
          <option value="phrase">Phrase</option>
          <option value="exact">Exact</option>
        </select>
        <button onClick={addKeyword} disabled={adding || !newText.trim()} className="btn btn-secondary">
          <Plus size={20} />
          Add
        </button>
      </div>

      {/* Status tabs — the primary cut through the list (§4.4). */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="tabs overflow-x-auto" role="tablist" aria-label="Filter by status">
          <button
            role="tab"
            aria-selected={statusFilter === "all"}
            onClick={() => {
              setStatusFilter("all");
              setVisibleCount(PAGE_SIZE);
            }}
            className={`tab ${statusFilter === "all" ? "tab-active" : ""}`}
          >
            All ({keptCount})
          </button>
          {STATUSES.map((status) => (
            <button
              key={status}
              role="tab"
              aria-selected={statusFilter === status}
              onClick={() => {
                setStatusFilter(status);
                setVisibleCount(PAGE_SIZE);
              }}
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
          <label className="sr-only" htmlFor="keyword-search">
            Search keywords
          </label>
          <input
            id="keyword-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Search keywords"
            className="input input-with-icon"
          />
        </div>

        <select
          value={sourceFilter}
          onChange={(e) => {
            setSourceFilter(e.target.value);
            setVisibleCount(PAGE_SIZE);
          }}
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
            onChange={(e) => {
              setFilterFilter(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
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
        <div className="table-wrap" aria-busy="true" aria-label="Loading keywords">
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
            <Sparkles size={24} />
          </span>
          <div className="space-y-1">
            <p className="empty-state-title">
              {keywords.length === 0 ? "No keywords yet" : "No keywords match these filters"}
            </p>
            <p className="empty-state-body">
              {keywords.length === 0
                ? "Generate them from this book's metadata, or add your own above."
                : "Try a different status tab, or clear the search."}
            </p>
          </div>
          {keywords.length === 0 ? (
            <button onClick={() => setShowGenerateForm(true)} className="btn btn-primary">
              <Sparkles size={20} />
              Generate keywords
            </button>
          ) : (
            <button
              onClick={() => {
                setSearch("");
                setStatusFilter("all");
                setSourceFilter("all");
                setFilterFilter("all");
              }}
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
                      aria-label="Select all shown keywords"
                    />
                  </th>
                  <th scope="col">Keyword</th>
                  <th scope="col">Match</th>
                  <th scope="col" className="hidden lg:table-cell">
                    Source
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
                      {keyword.category && (
                        <p className="meta-line text-xs">{keyword.category.replace(/-/g, " ")}</p>
                      )}
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
                    <td className="hidden lg:table-cell">{labelForSource(keyword.source)}</td>
                    <td className="hidden xl:table-cell">
                      {keyword.rejected_by_filter ? (
                        <span title={keyword.rejection_reason ?? undefined}>
                          <span className="cell-primary">{labelForFilter(keyword.rejected_by_filter).trim()}</span>
                          {keyword.rejection_reason && (
                            <span className="meta-line block text-xs">{keyword.rejection_reason}</span>
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
                        onChange={(e) => updateKeyword(keyword.id, { status: e.target.value as KeywordStatus })}
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
                      <button
                        onClick={() => deleteKeyword(keyword.id)}
                        className="btn btn-tertiary btn-icon btn-sm"
                        aria-label={`Delete ${keyword.text}`}
                        title="Delete keyword"
                      >
                        <Trash2 size={16} style={{ color: "var(--icon-default)" }} />
                      </button>
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
