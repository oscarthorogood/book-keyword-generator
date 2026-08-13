"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import type { AttentionItem } from "@/lib/dashboardStats";

const REASON_BADGE: Record<AttentionItem["reason"], string> = {
  capture_issue: "badge-error",
  no_campaigns: "badge-warning",
  export_failed: "badge-error",
};

/**
 * Short badge text per reason. A lookup rather than a ternary chain: the
 * chain previously ended in a bare "Export" fallback, so a newly added
 * reason silently rendered under the wrong label.
 */
const REASON_BADGE_TEXT: Record<AttentionItem["reason"], string> = {
  capture_issue: "Capture",
  no_campaigns: "Campaigns",
  export_failed: "Export",
};

/**
 * Dashboard "Needs attention" widget: books with a flagged capture
 * snapshot, books with no campaigns yet, and campaigns whose last export
 * failed. Own fetch, fails soft.
 */
export default function AttentionWidget() {
  const [items, setItems] = useState<AttentionItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/attention")
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load attention items.");
        else setItems(body.items);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load attention items."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card p-5">
      <h2 className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
        Needs attention
      </h2>
      {loading ? (
        <div className="skeleton mt-3 h-24 w-full" />
      ) : error ? (
        <div className="alert alert-error mt-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : !items || items.length === 0 ? (
        <div className="mt-3 flex items-center gap-2">
          <CheckCircle2 size={18} style={{ color: "var(--icon-active)" }} />
          <p className="meta-line">Nothing needs attention right now.</p>
        </div>
      ) : (
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {items.slice(0, 8).map((item, i) => (
            <li key={`${item.bookId}-${item.reason}-${i}`} className="flex items-start gap-3 py-2">
              <span className={`badge ${REASON_BADGE[item.reason]} mt-0.5 shrink-0`}>
                {REASON_BADGE_TEXT[item.reason]}
              </span>
              <div className="min-w-0 flex-1">
                <Link href={`/books/${item.bookId}`} className="cell-primary block truncate">
                  {item.bookTitle}
                </Link>
                <p className="meta-line truncate text-xs">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
