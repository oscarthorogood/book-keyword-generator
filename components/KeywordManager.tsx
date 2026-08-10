"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2, Sparkles, X, Search, Loader2 } from "lucide-react";

type MatchType = "broad" | "phrase" | "exact";
type KeywordStatus = "active" | "paused" | "negative" | "archived";

interface Keyword {
  id: string;
  text: string;
  match_type: MatchType;
  category: string | null;
  status: KeywordStatus;
  bid: number | null;
  source: string | null;
  created_at: string;
}

interface GenerateSummary {
  insertedCount: number;
  alreadyPresentCount: number;
  generatedCount: number;
  contributingSources: string[];
  byMatchType: Record<string, number>;
  aiRanked: boolean;
}

interface KeywordManagerProps {
  bookId: string;
  metadataCapturedAt?: string;
  metadataReady: boolean;
  genreTerms: string[];
  onKeywordsChanged?: () => void;
}

const STATUSES: KeywordStatus[] = ["active", "paused", "negative", "archived"];
const PAGE_SIZE = 100;

const statusStyles: Record<KeywordStatus, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  paused: "bg-yellow-50 text-yellow-700 border-yellow-200",
  negative: "bg-red-50 text-red-700 border-red-200",
  archived: "bg-gray-50 text-gray-500 border-gray-200",
};

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

  const sources = useMemo(
    () => Array.from(new Set(keywords.map((k) => k.source).filter((s): s is string => !!s))).sort(),
    [keywords]
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return keywords.filter((k) => {
      if (statusFilter !== "all" && k.status !== statusFilter) return false;
      if (sourceFilter !== "all" && k.source !== sourceFilter) return false;
      if (term && !k.text.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [keywords, statusFilter, sourceFilter, search]);

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
      <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
        <div>
          <p className="card-title">Keyword manager</p>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {keywords.length} keyword{keywords.length === 1 ? "" : "s"} for this book
            {metadataCapturedAt ? " · generated from the metadata captured when the book was added" : ""}
          </p>
        </div>
        <button onClick={() => setShowGenerateForm((open) => !open)} className="btn-pill-dark">
          <Sparkles size={15} />
          Generate keywords
        </button>
      </div>

      {showGenerateForm && (
        <div className="rounded-2xl border p-4 mb-5" style={{ background: "var(--panel-muted)" }}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>
                Generate from this book&apos;s metadata
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Runs the stored ASIN scrape — categories, comparable titles, reviews, Q&amp;A, author
                catalogue, Goodreads/Open Library/Google Books — through every keyword source, plus live
                Amazon, Google, YouTube and DuckDuckGo autocomplete sweeps.
              </p>
              {genreTerms.length > 0 && (
                <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                  Seeding genres: {genreTerms.slice(0, 6).join(", ")}
                </p>
              )}
            </div>
            <button
              onClick={() => setShowGenerateForm(false)}
              aria-label="Close"
              style={{ color: "var(--muted)" }}
            >
              <X size={16} />
            </button>
          </div>

          {!metadataReady && (
            <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>
              This book&apos;s metadata is incomplete. Re-fetch it above before generating, or the keywords
              won&apos;t reflect the book.
            </p>
          )}

          <label className="field-label" htmlFor="key-tropes">
            Key tropes or themes (optional, one per line)
          </label>
          <textarea
            id="key-tropes"
            value={keyTropes}
            onChange={(e) => setKeyTropes(e.target.value)}
            rows={2}
            placeholder="e.g. enemies to lovers, small town, locked room mystery"
            className="input resize-none mb-3"
          />
          {generateError && (
            <p className="text-xs mb-3" style={{ color: "var(--accent-red)" }}>
              {generateError}
            </p>
          )}
          <button onClick={generateKeywords} disabled={generating || !metadataReady} className="btn-pill-dark">
            {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            {generating ? "Generating…" : "Generate keywords"}
          </button>
        </div>
      )}

      {summary && (
        <div className="status-banner mb-5" style={{ background: "var(--panel-muted)" }}>
          <span className="status-dot" style={{ background: "var(--accent-green)" }} />
          <div className="text-xs" style={{ color: "var(--muted)" }}>
            <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
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
            <p className="mt-1">{summary.contributingSources.map(labelForSource).join(", ")}</p>
          </div>
        </div>
      )}

      {/* Add keyword */}
      <div className="flex items-start gap-2 mb-4">
        <textarea
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          placeholder="Add a keyword, or paste a list (one per line / comma separated)"
          rows={1}
          className="input flex-1 resize-none"
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
        <button onClick={addKeyword} disabled={adding || !newText.trim()} className="btn-pill-dark">
          <Plus size={15} />
          Add
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-2.5" style={{ color: "var(--muted)" }} />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
            placeholder="Search keywords…"
            className="input pl-9"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as "all" | KeywordStatus);
            setVisibleCount(PAGE_SIZE);
          }}
          className="input w-auto"
          aria-label="Filter by status"
        >
          <option value="all">All statuses ({keywords.length})</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status[0].toUpperCase() + status.slice(1)} ({keywords.filter((k) => k.status === status).length})
            </option>
          ))}
        </select>

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
      </div>

      {selected.size > 0 && (
        <div
          className="flex items-center gap-2 flex-wrap rounded-2xl border px-4 py-3 mb-4"
          style={{ background: "var(--panel-muted)" }}
        >
          <span className="text-sm font-medium" style={{ color: "var(--ink)" }}>
            {selected.size} selected
          </span>
          {STATUSES.map((status) => (
            <button key={status} onClick={() => bulkUpdate(status)} className="btn-pill-outline">
              Mark {status}
            </button>
          ))}
          <button onClick={bulkDelete} className="btn-pill-outline" style={{ color: "var(--accent-red)" }}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}

      {loading ? (
        <p className="text-center py-10 text-sm" style={{ color: "var(--muted)" }}>
          Loading keywords…
        </p>
      ) : visible.length === 0 ? (
        <div className="text-center py-12 rounded-2xl border" style={{ background: "var(--panel-muted)" }}>
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {keywords.length === 0
              ? "No keywords yet. Generate them from this book's metadata, or add your own above."
              : "No keywords match these filters."}
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase" style={{ background: "var(--panel-muted)", color: "var(--muted)" }}>
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      onChange={toggleAllOnPage}
                      aria-label="Select all shown keywords"
                    />
                  </th>
                  <th className="text-left px-4 py-2 font-medium">Keyword</th>
                  <th className="text-left px-4 py-2 font-medium">Match</th>
                  <th className="text-left px-4 py-2 font-medium">Source</th>
                  <th className="text-left px-4 py-2 font-medium">Category</th>
                  <th className="text-left px-4 py-2 font-medium">Bid</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {page.map((keyword) => (
                  <tr key={keyword.id}>
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
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
                    <td className="px-4 py-2" style={{ color: "var(--ink)" }}>
                      {keyword.text}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={keyword.match_type}
                        onChange={(e) =>
                          updateKeyword(keyword.id, { match_type: e.target.value as MatchType })
                        }
                        className="border rounded px-2 py-1 text-xs"
                        style={{ background: "var(--panel)", color: "var(--ink)" }}
                        aria-label="Match type"
                      >
                        <option value="broad">Broad</option>
                        <option value="phrase">Phrase</option>
                        <option value="exact">Exact</option>
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: "var(--muted)" }}>
                      {labelForSource(keyword.source)}
                    </td>
                    <td className="px-4 py-2 text-xs" style={{ color: "var(--muted)" }}>
                      {keyword.category ? keyword.category.replace(/-/g, " ") : "—"}
                    </td>
                    <td className="px-4 py-2">
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
                        className="w-20 border rounded px-2 py-1 text-xs"
                        style={{ background: "var(--panel)", color: "var(--ink)" }}
                        aria-label="Bid"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={keyword.status}
                        onChange={(e) => updateKeyword(keyword.id, { status: e.target.value as KeywordStatus })}
                        className={`border rounded px-2 py-1 text-xs font-medium ${statusStyles[keyword.status]}`}
                        aria-label="Status"
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status[0].toUpperCase() + status.slice(1)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => deleteKeyword(keyword.id)}
                        title="Delete keyword"
                        style={{ color: "var(--muted)" }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-3">
            <p className="text-xs" style={{ color: "var(--muted)" }}>
              Showing {page.length} of {visible.length}
            </p>
            {page.length < visible.length && (
              <button onClick={() => setVisibleCount((count) => count + PAGE_SIZE)} className="btn-pill-outline">
                Show more
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
