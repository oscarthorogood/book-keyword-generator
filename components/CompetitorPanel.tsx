"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Loader2, Plus, Search, Swords, Trash2 } from "lucide-react";

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
  match_type: string;
  specificity: number | null;
  status: string;
}

const SOURCES = ["manual", "kdpradar", "datadive", "helium10", "sellersprite"];

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

function toCsv(rows: CompetitorKeywordRow[]): string {
  const header = ["text", "match_type", "volume", "rank", "competitor_count", "mean_rank", "category", "competitor_asin"];
  const lines = [header.join(",")];
  for (const row of rows) {
    lines.push(
      [
        `"${row.text.replace(/"/g, '""')}"`,
        row.match_type,
        row.volume,
        row.rank ?? "",
        row.competitor_count,
        row.mean_rank ?? "",
        row.category ?? "",
        row.competitor_asin,
      ].join(",")
    );
  }
  return lines.join("\n");
}

/**
 * Competitor-ASIN + competitor-keyword panel (spec §6) — the mode="competitors"
 * half of BookKeywordPanel. Same shape of behaviour as KeywordManager
 * (search, category/match-type filtering, CSV export) but reading from the
 * separate competitor_asins/competitor_keywords tables via lib/competitorStore.ts.
 */
export default function CompetitorPanel({ bookId }: { bookId: string }) {
  const [asins, setAsins] = useState<CompetitorAsinRow[]>([]);
  const [keywords, setKeywords] = useState<CompetitorKeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newAsin, setNewAsin] = useState("");
  const [newSource, setNewSource] = useState("manual");
  const [adding, setAdding] = useState(false);

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | string>("all");
  const [matchTypeFilter, setMatchTypeFilter] = useState<"all" | string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  async function reload() {
    setLoading(true);
    const [loadedAsins, loadedKeywords] = await Promise.all([
      fetchCompetitorAsins(bookId),
      fetchCompetitorKeywords(bookId),
    ]);
    setAsins(loadedAsins);
    setKeywords(loadedKeywords);
    setLoading(false);
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

  async function addAsin() {
    const value = newAsin.trim();
    if (!value) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/competitors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ competitor_asin: value, source: newSource }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || "Could not add competitor ASIN.");
        return;
      }
      setNewAsin("");
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

  async function bulkDeleteKeywords() {
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

  const categories = useMemo(
    () => Array.from(new Set(keywords.map((k) => k.category).filter((c): c is string => !!c))).sort(),
    [keywords]
  );
  const matchTypes = useMemo(() => Array.from(new Set(keywords.map((k) => k.match_type))).sort(), [keywords]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return keywords.filter((k) => {
      if (term && !k.text.toLowerCase().includes(term)) return false;
      if (categoryFilter !== "all" && k.category !== categoryFilter) return false;
      if (matchTypeFilter !== "all" && k.match_type !== matchTypeFilter) return false;
      return true;
    });
  }, [keywords, search, categoryFilter, matchTypeFilter]);

  function exportCsv() {
    const csv = toCsv(visible);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${bookId}-competitor-keywords.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="card">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="card-title">Competitor ASINs &amp; keywords</p>
          <p className="meta-line mt-1">
            {asins.length} competitor ASIN{asins.length === 1 ? "" : "s"} · {keywords.length} imported keyword
            {keywords.length === 1 ? "" : "s"}
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={visible.length === 0}
          className="btn btn-secondary"
          title="Export the filtered competitor keywords as CSV"
        >
          <Download size={20} />
          Export CSV
        </button>
      </div>

      {error && (
        <div className="alert alert-error mb-4" role="alert">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Add competitor ASIN */}
      <div className="mb-6 flex flex-wrap items-start gap-3">
        <input
          value={newAsin}
          onChange={(e) => setNewAsin(e.target.value)}
          placeholder="Competitor ASIN, e.g. B0ABCD1234"
          className="input min-w-[220px] flex-1"
          aria-label="New competitor ASIN"
          onKeyDown={(e) => {
            if (e.key === "Enter") addAsin();
          }}
        />
        <select value={newSource} onChange={(e) => setNewSource(e.target.value)} className="input w-auto" aria-label="Source">
          {SOURCES.map((source) => (
            <option key={source} value={source}>
              {source}
            </option>
          ))}
        </select>
        <button onClick={addAsin} disabled={adding || !newAsin.trim()} className="btn btn-secondary">
          {adding ? <Loader2 size={20} className="animate-spin" /> : <Plus size={20} />}
          Add ASIN
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

      {/* Search + filters (mirrors KeywordManager's behaviour) */}
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
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search competitor keywords"
            className="input input-with-icon"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
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
          onChange={(e) => setMatchTypeFilter(e.target.value)}
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
      </div>

      {selected.size > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border p-3"
          style={{ background: "var(--bg-subtle)", borderColor: "var(--line)" }}
        >
          <span className="mr-1 text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            {selected.size} selected
          </span>
          <button onClick={bulkDeleteKeywords} className="btn btn-destructive btn-sm">
            <Trash2 size={16} />
            Delete
          </button>
        </div>
      )}

      {loading ? (
        <div className="table-wrap" aria-busy="true" aria-label="Loading competitor keywords">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-4 border-b p-4" style={{ borderColor: "var(--line)" }}>
              <div className="skeleton h-4 flex-1" />
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
                ? "Add a competitor ASIN above, then import a reverse-ASIN export via the API to populate this list."
                : "Try clearing the search or filters."}
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table table-dense">
            <thead>
              <tr>
                <th scope="col" className="w-8">
                  <span className="sr-only">Select</span>
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
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((keyword) => (
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
                  <td>{keyword.match_type}</td>
                  <td>{keyword.volume}</td>
                  <td>{keyword.rank ?? "—"}</td>
                  <td className="hidden lg:table-cell">
                    {keyword.competitor_count}
                    {keyword.mean_rank !== null && (
                      <span className="meta-line text-xs"> · mean rank {keyword.mean_rank}</span>
                    )}
                  </td>
                  <td className="hidden xl:table-cell">{keyword.category?.replace(/-/g, " ") ?? "—"}</td>
                  <td className="text-right">
                    <button
                      onClick={async () => {
                        setKeywords((prev) => prev.filter((k) => k.id !== keyword.id));
                        await fetch(`/api/books/${bookId}/competitor-keywords`, {
                          method: "DELETE",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ ids: [keyword.id] }),
                        });
                      }}
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
      )}
    </section>
  );
}
