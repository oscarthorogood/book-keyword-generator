"use client";

import { useEffect, useState } from "react";

interface CampaignRow {
  id: string;
  name: string;
  status: string;
  updated_at: string;
  last_export_error: string | null;
  last_export_error_at: string | null;
}

interface ActivityItem {
  key: string;
  title: string;
  at: string;
  dotColor: string;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffMs = Date.now() - then;
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * "Recent activity" timeline — built entirely from real, already-persisted
 * timestamps (campaigns.updated_at / last_export_error_at, the book's
 * capture time), never simulated. A book with no campaign history yet just
 * shows the capture event.
 */
export default function BookRecentActivity({ bookId, capturedAt }: { bookId: string; capturedAt?: string }) {
  const [campaigns, setCampaigns] = useState<CampaignRow[] | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/books/${bookId}/campaigns`)
      .then((res) => (res.ok ? res.json() : { campaigns: [] }))
      .then((body) => {
        if (active) setCampaigns(Array.isArray(body.campaigns) ? body.campaigns : []);
      })
      .catch(() => active && setCampaigns([]));
    return () => {
      active = false;
    };
  }, [bookId]);

  const items: ActivityItem[] = [];
  for (const c of campaigns ?? []) {
    if (c.last_export_error && c.last_export_error_at) {
      items.push({ key: `${c.id}-error`, title: `${c.name}: export failed`, at: c.last_export_error_at, dotColor: "var(--color-error-500)" });
    } else if (c.status === "exported" || c.status === "live") {
      items.push({ key: `${c.id}-exported`, title: `${c.name} exported`, at: c.updated_at, dotColor: "var(--color-success-500)" });
    } else {
      items.push({ key: `${c.id}-${c.status}`, title: `${c.name} — ${c.status}`, at: c.updated_at, dotColor: "var(--accent)" });
    }
  }
  if (capturedAt) {
    items.push({ key: "capture", title: "Metadata captured from Amazon", at: capturedAt, dotColor: "var(--text-placeholder)" });
  }
  items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  const visible = items.slice(0, 6);

  return (
    <section className="card">
      <p className="card-title">Recent activity</p>
      {campaigns === null ? (
        <div className="skeleton mt-3 h-16 w-full" />
      ) : visible.length === 0 ? (
        <p className="meta-line mt-3">Nothing yet.</p>
      ) : (
        <ul className="mt-2">
          {visible.map((item) => (
            <li key={item.key} className="flex items-start gap-3 border-t py-2.5 first:border-t-0" style={{ borderColor: "var(--bg-muted)" }}>
              <span className="status-dot mt-1.5 shrink-0" style={{ background: item.dotColor }} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  {item.title}
                </p>
                <p className="meta-line mt-0.5 text-xs">{relativeTime(item.at)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
