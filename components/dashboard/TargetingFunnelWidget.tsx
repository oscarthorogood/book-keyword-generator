"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, Zap } from "lucide-react";
import type { TargetingSummary } from "@/lib/dashboardStats";

/** Bars progress light-to-dark; only the final (darkest) stage needs white text. */
const HERO_BAR_COLORS = ["#f0dfa0", "#f7e38c", "#f5d468", "#101828"];
const COMPACT_BAR_COLORS = ["#f5e6a8", "#f2d65c", "#f2c230", "#101828"];
const BAR_TEXT_COLORS = ["#101828", "#101828", "#101828", "#ffffff"];

/**
 * "Keyword & ASIN funnel" — how far research narrows down to a live,
 * exported target. `hero` is the Dashboard's large card (icon header +
 * "filtered out" footer stat); `compact` is the smaller card reused on the
 * Book detail page, scoped to that one book via `bookId`.
 */
export default function TargetingFunnelWidget({
  bookId,
  variant = "hero",
}: {
  bookId?: string;
  variant?: "hero" | "compact";
}) {
  const [summary, setSummary] = useState<TargetingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const url = bookId ? `/api/dashboard/targeting?bookId=${bookId}` : "/api/dashboard/targeting";
    fetch(url)
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load the targeting funnel.");
        else setSummary(body.summary);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load the targeting funnel."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [bookId]);

  const isHero = variant === "hero";
  const colors = isHero ? HERO_BAR_COLORS : COMPACT_BAR_COLORS;

  if (loading) {
    return (
      <section className="card">
        <div className="skeleton h-6 w-48" />
        <div className="mt-6 space-y-3">
          <div className="skeleton h-9 w-full" />
          <div className="skeleton h-9 w-full" />
        </div>
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="card">
        <div className="alert alert-error" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error || "Couldn't load the targeting funnel."}</p>
        </div>
      </section>
    );
  }

  const researched = summary.stages[0]?.value ?? 0;
  const selected = summary.stages[2]?.value ?? 0;
  const filteredOutPct = researched > 0 ? Math.round(((researched - selected) / researched) * 100) : 0;
  const max = Math.max(1, ...summary.stages.map((s) => s.value));

  return (
    <section className="card">
      {isHero && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <span className="stat-tile-icon">
              <Zap size={20} />
            </span>
            <div>
              <p className="card-title" style={{ fontSize: "1.375rem" }}>
                Keyword &amp; ASIN funnel
              </p>
              <p className="meta-line mt-1.5 max-w-xs">
                How research narrows down to what actually goes live in a campaign.
              </p>
            </div>
          </div>
          <span className="badge badge-gray">All books</span>
        </div>
      )}
      {!isHero && <p className="card-title">Keyword &amp; ASIN funnel</p>}

      <div className={isHero ? "mt-7 flex flex-col gap-3.5" : "mt-4 flex flex-col gap-2.5"}>
        {summary.stages.map((stage, i) => (
          <div key={stage.label} className="funnel-row">
            <span className="funnel-label" style={{ width: isHero ? 150 : 120, fontSize: isHero ? undefined : "0.75rem" }}>
              {stage.label}
            </span>
            <div className={`funnel-track ${isHero ? "" : "funnel-track-sm"}`}>
              <div
                className={`funnel-fill ${isHero ? "" : "funnel-fill-sm"}`}
                style={{ width: `${Math.max((stage.value / max) * 100, 12)}%`, background: colors[i] }}
              >
                <span style={{ color: BAR_TEXT_COLORS[i] }}>{stage.value.toLocaleString()}</span>
              </div>
            </div>
            {isHero && <span className="funnel-note" style={{ width: 150 }}>{stage.note}</span>}
          </div>
        ))}
      </div>

      {isHero && (
        <div className="mt-6 flex items-center gap-2.5 border-t pt-5" style={{ borderColor: "var(--line)" }}>
          <span className="badge badge-error">
            <ArrowDown size={14} />
            {filteredOutPct}%
          </span>
          <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
            of researched keywords are filtered out before reaching a campaign.
          </span>
        </div>
      )}
    </section>
  );
}
