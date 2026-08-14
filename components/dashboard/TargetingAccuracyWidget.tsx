"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Calendar } from "lucide-react";
import type { TargetingSummary } from "@/lib/dashboardStats";

/**
 * "Targeting accuracy" donut — share of live keywords/ASINs that converted
 * at least one sale. `lg` is the Dashboard's version (with the
 * "correctly filtered out" / "converting targets found" stat pair below
 * it); `sm` is the tighter Book detail card.
 */
export default function TargetingAccuracyWidget({
  bookId,
  variant = "lg",
}: {
  bookId?: string;
  variant?: "lg" | "sm";
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
        if (!res.ok) setError(body.error || "Couldn't load targeting accuracy.");
        else setSummary(body.summary);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load targeting accuracy."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [bookId]);

  const isLg = variant === "lg";

  if (loading) {
    return (
      <section className="card">
        <div className="skeleton h-6 w-40" />
        <div className="skeleton mt-4 h-20 w-full" />
      </section>
    );
  }

  if (error || !summary) {
    return (
      <section className="card">
        <div className="alert alert-error" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error || "Couldn't load targeting accuracy."}</p>
        </div>
      </section>
    );
  }

  const pct = summary.accuracyPct;
  const researched = summary.stages[0]?.value ?? 0;
  const selected = summary.stages[2]?.value ?? 0;
  // "Correctly filtered out" isn't measurable — there's no way to know
  // whether a discarded keyword would have converted. This is the honestly
  // derivable cousin: how much of what was researched never reached a
  // campaign at all.
  const filteredOutPct = researched > 0 ? Math.round(((researched - selected) / researched) * 100) : null;
  const ringSize = isLg ? 76 : 64;
  const holeSize = isLg ? 60 : 52;
  const ringStyle =
    pct === null
      ? { background: "var(--bg-muted)" }
      : { background: `conic-gradient(var(--primary-solid) 0% ${pct}%, var(--line) ${pct}% 100%)` };

  return (
    <section className="card">
      <div className="flex items-center justify-between">
        <p className="card-title">Targeting accuracy</p>
        {isLg && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: "var(--text-secondary)" }}>
            <Calendar size={14} />
            Last 30 days
          </span>
        )}
      </div>

      <div className="mt-4 flex items-center gap-5">
        <div
          className="flex shrink-0 items-center justify-center rounded-full"
          style={{ width: ringSize, height: ringSize, ...ringStyle }}
        >
          <div
            className="flex flex-col items-center justify-center rounded-full bg-white"
            style={{ width: holeSize, height: holeSize }}
          >
            <span
              className="font-bold"
              style={{ fontSize: isLg ? "1.25rem" : "1.0625rem", color: "var(--text-primary)" }}
            >
              {pct === null ? "—" : `${pct}%`}
            </span>
          </div>
        </div>
        <div className="flex-1">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Share of live keywords &amp; ASINs that went on to convert at least one sale.
          </p>
          {isLg && (
            <p className="meta-line mt-2.5 text-xs">
              Based on {summary.liveCount.toLocaleString()} live target{summary.liveCount === 1 ? "" : "s"}, last 30
              days
            </p>
          )}
        </div>
      </div>

      {isLg && (
        <div className="mt-5 flex gap-3 border-t pt-4" style={{ borderColor: "var(--line)" }}>
          <div className="flex-1">
            <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {filteredOutPct === null ? "—" : `${filteredOutPct}%`}
            </p>
            <p className="meta-line mt-0.5 text-xs">Filtered out before campaign</p>
          </div>
          <div className="flex-1">
            <p className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
              {summary.convertingCount.toLocaleString()}
            </p>
            <p className="meta-line mt-0.5 text-xs">Converting targets found</p>
          </div>
        </div>
      )}
    </section>
  );
}
