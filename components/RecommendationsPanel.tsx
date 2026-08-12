"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Download, RefreshCw, ThumbsDown, ThumbsUp, X } from "lucide-react";

interface Recommendation {
  id: string;
  keyword_id: string | null;
  competitor_asin_id: string | null;
  campaign_id: string | null;
  type: "increase_bid" | "decrease_bid" | "archive" | "reactivate" | "pause" | "promote_to_alpha_exact";
  current_bid: number | null;
  suggested_bid: number | null;
  reason: string | null;
  confidence: "low" | "medium" | "high" | null;
}

const TYPE_LABEL: Record<Recommendation["type"], string> = {
  increase_bid: "Increase bid",
  decrease_bid: "Decrease bid",
  archive: "Archive",
  reactivate: "Reactivate",
  pause: "Pause",
  promote_to_alpha_exact: "Promote to Alpha Exact",
};

/**
 * Pending bid/archive/promotion recommendations for a book (campaigns spec
 * §6/§7). Reusable — book detail page and the campaign detail page (PR 11)
 * both use it; the fetch is always book-scoped (that's what the API
 * generates against), and an optional `campaignId` filters the displayed
 * list down to that one sub-campaign's recommendations without a second
 * endpoint. Own fetch, fails soft, same pattern as CannibalizationPanel.
 */
export default function RecommendationsPanel({ bookId, campaignId }: { bookId: string; campaignId?: string }) {
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function load(active: () => boolean = () => true) {
    return fetch(`/api/books/${bookId}/recommendations`)
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (!active()) return;
        if (Array.isArray(body.recommendations)) {
          setRecommendations(body.recommendations);
          setError(null);
        } else {
          setError(body.error || "Could not load recommendations.");
        }
      })
      .catch((err) => {
        if (active()) setError(err instanceof Error ? err.message : "Could not load recommendations.");
      });
  }

  const visible = campaignId ? (recommendations ?? []).filter((r) => r.campaign_id === campaignId) : recommendations;

  useEffect(() => {
    let mounted = true;
    void load(() => mounted);
    return () => {
      mounted = false;
    };
  }, [bookId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refresh() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  async function accept(rec: Recommendation) {
    let body: { mode?: string; confirm?: boolean } = {};
    if (rec.type === "archive") {
      const block = window.confirm(
        "Archive and block? OK = archive and add as a negative keyword (stronger). Cancel = archive only (reversible)."
      );
      body = { mode: block ? "archive-and-block" : "archive-only" };
    } else if (rec.type === "promote_to_alpha_exact") {
      const confirmed = window.confirm(
        "This moves the keyword into Alpha Exact, negative-exacts it in BMM Discovery, and archives the BMM row. Continue?"
      );
      if (!confirmed) return;
      body = { confirm: true };
    }

    setDecidingId(rec.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/recommendations/${rec.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const resBody = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecommendations((prev) => (prev ? prev.filter((r) => r.id !== rec.id) : prev));
      } else {
        setActionError(resBody.error || "Could not accept recommendation.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not accept recommendation.");
    } finally {
      setDecidingId(null);
    }
  }

  async function reject(rec: Recommendation) {
    setDecidingId(rec.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/recommendations/${rec.id}/reject`, { method: "POST" });
      const resBody = await res.json().catch(() => ({}));
      if (res.ok) {
        setRecommendations((prev) => (prev ? prev.filter((r) => r.id !== rec.id) : prev));
      } else {
        setActionError(resBody.error || "Could not reject recommendation.");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not reject recommendation.");
    } finally {
      setDecidingId(null);
    }
  }

  if (!error && (!visible || visible.length === 0)) return null;

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-md font-semibold">
          Recommendations <span className="meta-line">({visible?.length ?? 0} pending)</span>
        </h2>
        <div className="flex items-center gap-2">
          <button onClick={refresh} disabled={refreshing} className="btn btn-tertiary btn-sm">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} /> Refresh
          </button>
          <a href={`/api/books/${bookId}/recommendations/export`} className="btn btn-tertiary btn-sm">
            <Download size={14} /> Review CSV
          </a>
        </div>
      </div>

      {error && (
        <div className="alert alert-error mb-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{error}</p>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      {actionError && (
        <div className="alert alert-error mb-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p className="flex-1">{actionError}</p>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={() => setActionError(null)} aria-label="Dismiss error">
            <X size={14} />
          </button>
        </div>
      )}

      <ul className="space-y-2">
        {(visible ?? []).map((rec) => (
          <li key={rec.id} className="flex flex-wrap items-center gap-2">
            <span className="cell-primary">{TYPE_LABEL[rec.type]}</span>
            {rec.confidence && <span className="meta-line text-xs">({rec.confidence} confidence)</span>}
            <span className="meta-line text-xs flex-1 min-w-0">{rec.reason}</span>
            {rec.suggested_bid !== null && (
              <span className="meta-line text-xs">
                {rec.current_bid?.toFixed(2) ?? "?"} → {rec.suggested_bid.toFixed(2)}
              </span>
            )}
            <button
              onClick={() => accept(rec)}
              disabled={decidingId === rec.id}
              className="btn btn-tertiary btn-sm"
              aria-label="Accept"
            >
              <ThumbsUp size={14} /> Accept
            </button>
            <button
              onClick={() => reject(rec)}
              disabled={decidingId === rec.id}
              className="btn btn-tertiary btn-sm"
              aria-label="Reject"
            >
              <ThumbsDown size={14} /> Reject
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
