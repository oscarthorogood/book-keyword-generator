"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, ThumbsDown, ThumbsUp } from "lucide-react";

interface Recommendation {
  id: string;
  keyword_id: string | null;
  competitor_asin_id: string | null;
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
 * §6/§7). Reusable — book detail page today; campaign detail and a global
 * pending view can reuse it once those pages exist (PR 11). Own fetch,
 * fails soft, same pattern as CannibalizationPanel.
 */
export default function RecommendationsPanel({ bookId }: { bookId: string }) {
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  function load(active: () => boolean = () => true) {
    return fetch(`/api/books/${bookId}/recommendations`)
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (active() && Array.isArray(body.recommendations)) setRecommendations(body.recommendations);
      })
      .catch(() => {
        /* fail soft — no panel rather than an error banner */
      });
  }

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
    try {
      const res = await fetch(`/api/books/${bookId}/recommendations/${rec.id}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setRecommendations((prev) => (prev ? prev.filter((r) => r.id !== rec.id) : prev));
    } finally {
      setDecidingId(null);
    }
  }

  async function reject(rec: Recommendation) {
    setDecidingId(rec.id);
    try {
      const res = await fetch(`/api/books/${bookId}/recommendations/${rec.id}/reject`, { method: "POST" });
      if (res.ok) setRecommendations((prev) => (prev ? prev.filter((r) => r.id !== rec.id) : prev));
    } finally {
      setDecidingId(null);
    }
  }

  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="card mb-6">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-md font-semibold">
          Recommendations <span className="meta-line">({recommendations.length} pending)</span>
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
      <ul className="space-y-2">
        {recommendations.map((rec) => (
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
