"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, Plus, Repeat, Search, X } from "lucide-react";

interface CampaignOption {
  id: string;
  name: string;
  campaign_type: string;
  status: string;
}

interface Target {
  id: string;
  keywordId: string | null;
  competitorAsinId: string | null;
  text: string;
  matchType: string | null;
  targetingExpression: string | null;
  bid: number | null;
  type: "keyword" | "asin";
}

interface SearchResult {
  id: string;
  text: string;
  matchType?: string | null;
  targetingExpression?: string | null;
  bid: number | null;
  type: "keyword" | "asin";
}

interface ManualUpdateModalProps {
  bookId: string;
  campaigns: CampaignOption[];
  onClose: () => void;
  /** Refreshes the campaign list/header after a swap changes a bulksheet. */
  onSwapped: (message: string) => void;
}

/**
 * "Manual update" (as opposed to Automatic update, which re-scores the
 * whole campaign): pick one campaign, see its current keywords/ASINs, and
 * swap any single one for another entry from this book's bank — searching
 * as you type, with a Create fallback when nothing matches.
 */
export default function ManualUpdateModal({ bookId, campaigns, onClose, onSwapped }: ManualUpdateModalProps) {
  const [campaignId, setCampaignId] = useState(campaigns[0]?.id ?? "");
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [swappingTargetId, setSwappingTargetId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [busyTargetId, setBusyTargetId] = useState<string | null>(null);

  /** Fetches without touching state, so the effect below never sets state synchronously. */
  const fetchTargets = useCallback(
    async (id: string): Promise<{ targets: Target[]; error: string | null }> => {
      try {
        const res = await fetch(`/api/books/${bookId}/campaigns/${id}/targets`);
        const body = await res.json().catch(() => ({}));
        if (!res.ok) return { targets: [], error: body.error ?? "Could not load this campaign's keywords." };
        return { targets: body.targets ?? [], error: null };
      } catch {
        return { targets: [], error: "Could not load this campaign's keywords." };
      }
    },
    [bookId]
  );

  const loadTargets = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    const { targets: loaded, error: loadError } = await fetchTargets(campaignId);
    setTargets(loaded);
    setError(loadError);
    setLoading(false);
  }, [campaignId, fetchTargets]);

  useEffect(() => {
    if (!campaignId) return;
    let active = true;
    fetchTargets(campaignId).then(({ targets: loaded, error: loadError }) => {
      if (!active) return;
      setTargets(loaded);
      setError(loadError);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [campaignId, fetchTargets]);

  const swappingTarget = useMemo(() => targets.find((t) => t.id === swappingTargetId) ?? null, [targets, swappingTargetId]);

  const runSearch = useCallback(
    async (text: string, type: "keyword" | "asin") => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/books/${bookId}/campaigns/${campaignId}/targets/search?type=${type}&q=${encodeURIComponent(text)}`
        );
        const body = await res.json().catch(() => ({}));
        setResults(res.ok ? body.results ?? [] : []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    },
    [bookId, campaignId]
  );

  useEffect(() => {
    if (!swappingTarget) return;
    const handle = setTimeout(() => runSearch(query, swappingTarget.type), 250);
    return () => clearTimeout(handle);
  }, [query, swappingTarget, runSearch]);

  function startSwap(target: Target) {
    setSwappingTargetId(target.id);
    setQuery("");
    setResults([]);
    setError(null);
  }

  function cancelSwap() {
    setSwappingTargetId(null);
    setQuery("");
    setResults([]);
  }

  async function performSwap(target: Target, body: Record<string, unknown>) {
    setBusyTargetId(target.id);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns/${campaignId}/targets/swap`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          old: {
            keywordId: target.keywordId ?? undefined,
            competitorAsinId: target.competitorAsinId ?? undefined,
            text: target.text,
            matchType: target.matchType ?? undefined,
            targetingExpression: target.targetingExpression ?? undefined,
            bid: target.bid,
          },
          ...body,
        }),
      });
      const responseBody = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(responseBody.error ?? "Could not swap this target.");
        return;
      }
      cancelSwap();
      await loadTargets();
      onSwapped(`Swapped "${responseBody.swapped?.from ?? target.text}" for "${responseBody.swapped?.to ?? "the new target"}".`);
    } catch {
      setError("Could not swap this target.");
    } finally {
      setBusyTargetId(null);
    }
  }

  function chooseExisting(target: Target, result: SearchResult) {
    performSwap(target, result.type === "asin" ? { newCompetitorAsinId: result.id } : { newKeywordId: result.id });
  }

  function createAndUse(target: Target) {
    if (!query.trim()) return;
    performSwap(
      target,
      target.type === "asin"
        ? { createAsin: { competitorAsin: query.trim() } }
        : { createKeyword: { text: query.trim(), matchType: target.matchType ?? "phrase" } }
    );
  }

  const exactMatch = results.some((r) => r.text.toLowerCase() === query.trim().toLowerCase());

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manual update"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "var(--bg-surface, #fff)",
          borderRadius: 12,
          padding: 24,
          width: "min(640px, 92vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Manual update</h2>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <label className="block mb-3">
          <span className="text-sm font-medium">Campaign</span>
          <select
            className="input mt-1 w-full"
            value={campaignId}
            onChange={(e) => {
              setCampaignId(e.target.value);
              setLoading(true);
              cancelSwap();
            }}
          >
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        {error && (
          <div className="alert alert-error mb-3" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <p className="flex-1">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="skeleton h-8 w-full" />
            <div className="skeleton h-8 w-full" />
            <div className="skeleton h-8 w-full" />
          </div>
        ) : targets.length === 0 ? (
          <p className="meta-line">This campaign has no active keywords or ASINs to swap.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
            {targets.map((target) => (
              <li key={target.id} className="py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="cell-primary truncate">{target.text}</p>
                    <p className="meta-line text-xs">
                      {target.type === "asin" ? "ASIN" : target.matchType ?? "phrase"}
                      {target.bid !== null ? ` · $${target.bid.toFixed(2)}` : ""}
                    </p>
                  </div>
                  <button
                    className="btn btn-tertiary btn-sm shrink-0"
                    onClick={() => (swappingTargetId === target.id ? cancelSwap() : startSwap(target))}
                    disabled={busyTargetId !== null}
                  >
                    {busyTargetId === target.id ? <Loader2 size={14} className="animate-spin" /> : <Repeat size={14} />}
                    Swap
                  </button>
                </div>

                {swappingTargetId === target.id && (
                  <div className="mt-3 rounded-md border p-3" style={{ borderColor: "var(--line)" }}>
                    <label className="block">
                      <span className="text-sm font-medium">
                        Search this book&rsquo;s {target.type === "asin" ? "ASIN" : "keyword"} bank
                      </span>
                      <div className="flex items-center gap-2 mt-1">
                        <Search size={14} style={{ color: "var(--icon-default)" }} />
                        <input
                          className="input w-full"
                          autoFocus
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                          placeholder={target.type === "asin" ? "ASIN, e.g. B0XXXXXXXX" : "Type a keyword…"}
                        />
                      </div>
                    </label>

                    {searching ? (
                      <p className="meta-line mt-2">Searching…</p>
                    ) : results.length > 0 ? (
                      <ul className="mt-2 space-y-1">
                        {results.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2">
                            <span className="cell-primary truncate">
                              {r.text}
                              {r.matchType ? ` (${r.matchType})` : ""}
                            </span>
                            <button className="btn btn-tertiary btn-sm shrink-0" onClick={() => chooseExisting(target, r)}>
                              Use
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : query.trim() ? (
                      <p className="meta-line mt-2">No match in the bank yet.</p>
                    ) : null}

                    {query.trim() && !exactMatch && !searching && (
                      <button className="btn btn-secondary btn-sm mt-2" onClick={() => createAndUse(target)}>
                        <Plus size={14} /> Create &ldquo;{query.trim()}&rdquo; and use it
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="flex justify-end mt-4">
          <button className="btn btn-tertiary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
