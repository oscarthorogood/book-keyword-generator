"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen, Megaphone, Radio, Tags } from "lucide-react";

interface OverviewStats {
  bookCount: number;
  activeKeywordCount: number;
  campaignCount: number;
  liveCampaignCount: number;
}

const TILES: { key: keyof OverviewStats; label: string; icon: typeof BookOpen }[] = [
  { key: "bookCount", label: "Books", icon: BookOpen },
  { key: "activeKeywordCount", label: "Active keywords", icon: Tags },
  { key: "campaignCount", label: "Campaigns", icon: Megaphone },
  { key: "liveCampaignCount", label: "Live campaigns", icon: Radio },
];

/**
 * Dashboard KPI row: headline counts across every book/keyword/campaign the
 * user owns, at the top of the page above the detail widgets. Own fetch,
 * fails soft — a stat tile row that can't load just shows an inline error
 * instead of blanking the rest of the dashboard.
 */
export default function OverviewStatsWidget() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/overview-stats")
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load overview stats.");
        else setStats(body.stats);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load overview stats."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        <AlertTriangle size={18} className="mt-0.5 shrink-0" />
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map(({ key, label, icon: Icon }) => (
        <div key={key} className="card card-compact flex items-center gap-3">
          <span className="icon-tile">
            <Icon size={18} />
          </span>
          <div className="min-w-0">
            <p className="meta-line text-xs">{label}</p>
            {loading || !stats ? (
              <div className="skeleton mt-1 h-6 w-12" />
            ) : (
              <p className="text-xl font-semibold tabular-nums" style={{ color: "var(--text-primary)" }}>
                {stats[key].toLocaleString()}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
