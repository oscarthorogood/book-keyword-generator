"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import type { CampaignSummary } from "@/lib/dashboardStats";

const BAR_COLOR = "var(--icon-active, #2563eb)";

function SpendChart({ periods }: { periods: CampaignSummary["spendByPeriod"] }) {
  if (periods.length === 0) return <p className="meta-line">No imported results yet.</p>;

  const width = 100;
  const height = 40;
  const gap = 1.5;
  const barWidth = periods.length > 0 ? width / periods.length - gap : 0;
  const max = Math.max(1, ...periods.map((p) => p.spend));
  const first = periods[0];
  const last = periods[periods.length - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Spend across ${periods.length} report period${periods.length === 1 ? "" : "s"}`}
        className="h-24 w-full"
      >
        {periods.map((p, i) => {
          const barHeight = max > 0 ? (p.spend / max) * (height - 2) : 0;
          const x = i * (barWidth + gap);
          const y = height - barHeight;
          return (
            <rect
              key={`${p.reportStart}_${p.reportEnd}`}
              x={x}
              y={y}
              width={Math.max(barWidth, 0.5)}
              height={Math.max(barHeight, 1)}
              rx={1}
              fill={BAR_COLOR}
            >
              <title>
                {p.reportStart} to {p.reportEnd}: ${p.spend.toFixed(2)} spend, ${p.sales.toFixed(2)} sales
              </title>
            </rect>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-between text-xs" style={{ color: "var(--text-secondary)" }}>
        <span>{new Date(first.reportStart).toLocaleDateString()}</span>
        {periods.length > 1 && <span>{new Date(last.reportEnd).toLocaleDateString()}</span>}
      </div>
    </div>
  );
}

/**
 * Dashboard "Campaign performance" widget: lifetime spend/sales/ACOS across
 * every campaign the user has exported, plus a spend-over-time bar chart
 * from imported search-term reports (campaign_results). Own fetch, fails
 * soft, mirrors CampaignDetailPage.tsx's "Lifetime results" dl.
 */
export default function CampaignSummaryWidget() {
  const [summary, setSummary] = useState<CampaignSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/campaign-summary")
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load campaign performance.");
        else setSummary(body.summary);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load campaign performance."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card p-5">
      <h2 className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
        Campaign performance
      </h2>
      {loading ? (
        <div className="skeleton mt-3 h-40 w-full" />
      ) : error ? (
        <div className="alert alert-error mt-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : summary ? (
        summary.totalCampaigns === 0 ? (
          <p className="meta-line mt-3">No campaigns yet.</p>
        ) : (
          <div className="mt-3 space-y-4">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="meta-line text-xs">Spend</dt>
                <dd className="cell-primary">${summary.totals.spend.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="meta-line text-xs">Sales</dt>
                <dd className="cell-primary">${summary.totals.sales.toFixed(2)}</dd>
              </div>
              <div>
                <dt className="meta-line text-xs">Orders</dt>
                <dd className="cell-primary">{summary.totals.orders}</dd>
              </div>
              <div>
                <dt className="meta-line text-xs">Blended ACOS</dt>
                <dd className="cell-primary">
                  {summary.acos !== null ? `${(summary.acos * 100).toFixed(1)}%` : "—"}
                </dd>
              </div>
            </dl>
            <div>
              <p className="mb-2 text-sm font-medium">Spend over time</p>
              <SpendChart periods={summary.spendByPeriod} />
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}
