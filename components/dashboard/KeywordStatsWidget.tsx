"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { KeywordStatsSummary } from "@/lib/dashboardStats";

const SPECIFICITY_LABELS: Record<string, string> = {
  "1": "Broad",
  "2": "Somewhat broad",
  "3": "Medium",
  "4": "Somewhat specific",
  "5": "Very specific",
  unscored: "Not yet scored",
};

function labelForKey(key: string): string {
  return key.replace(/-/g, " ");
}

function Bars({ counts, labels }: { counts: Record<string, number>; labels?: Record<string, string> }) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0);
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (entries.length === 0) {
    return <p className="meta-line">No data yet.</p>;
  }
  return (
    <div className="space-y-2">
      {entries.map(([key, count]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="w-32 shrink-0 truncate text-sm capitalize">{labels?.[key] ?? labelForKey(key)}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
            <div
              className="h-full rounded-full"
              style={{ width: `${(count / max) * 100}%`, background: "var(--icon-active, #2563eb)" }}
            />
          </div>
          <span className="w-10 shrink-0 text-right text-sm tabular-nums">{count}</span>
        </div>
      ))}
    </div>
  );
}

/** Dashboard "Keyword stats" + "Specificity distribution" widgets (Enhancements spec §2). Own fetch, fails soft. */
export default function KeywordStatsWidget() {
  const [stats, setStats] = useState<KeywordStatsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/keyword-stats")
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load keyword stats.");
        else setStats(body.stats);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load keyword stats."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <section className="card p-5">
        <h2 className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
          Keyword stats
        </h2>
        {loading ? (
          <div className="skeleton mt-3 h-24 w-full" />
        ) : error ? (
          <div className="alert alert-error mt-3" role="alert">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{error}</p>
          </div>
        ) : stats ? (
          <div className="mt-3 space-y-4">
            <p className="meta-line">{stats.total} total keyword{stats.total === 1 ? "" : "s"}</p>
            <div>
              <p className="mb-2 text-sm font-medium">By status</p>
              <Bars counts={stats.byStatus} />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium">By match type</p>
              <Bars counts={stats.byMatchType} />
            </div>
          </div>
        ) : null}
      </section>

      <section className="card p-5">
        <h2 className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
          Specificity distribution
        </h2>
        {loading ? (
          <div className="skeleton mt-3 h-24 w-full" />
        ) : error ? (
          <p className="meta-line mt-3">Unavailable.</p>
        ) : stats ? (
          <div className="mt-3">
            <Bars
              counts={{
                "1": stats.specificityDistribution[1],
                "2": stats.specificityDistribution[2],
                "3": stats.specificityDistribution[3],
                "4": stats.specificityDistribution[4],
                "5": stats.specificityDistribution[5],
                unscored: stats.specificityDistribution.unscored,
              }}
              labels={SPECIFICITY_LABELS}
            />
          </div>
        ) : null}
      </section>
    </>
  );
}
