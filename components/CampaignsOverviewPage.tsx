"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, DollarSign, Megaphone, Radio, TrendingUp } from "lucide-react";
import Link from "next/link";
import { StatTilesRow } from "./StatTiles";

interface CampaignRow {
  id: string;
  book_id: string;
  export_batch_id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  currency: string;
  status: string;
  operation: string;
  updated_at: string;
  book_title: string | null;
  book_author: string | null;
  bulksheet_path?: string | null;
  last_export_error?: string | null;
  spend: number;
  sales: number;
  acos: number | null;
}

const STATUS_FILTERS = ["all", "live", "paused", "draft"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const STATUS_BADGE: Record<string, string> = {
  live: "badge-success",
  exported: "badge-success",
  paused: "badge-warning",
  draft: "badge-gray",
  archived: "badge-gray",
};

function labelForStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Cross-book campaigns list (campaigns spec §7) — every sub-campaign of
 * every book's campaign structure, with a status filter and spend/ACOS from
 * imported results. Links through to the book (edit) and to
 * `/campaigns/[id]` (export history, results, recommendations).
 */
export default function CampaignsOverviewPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let active = true;
    fetch("/api/campaigns")
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (!active) return;
        if (Array.isArray(body.campaigns)) setCampaigns(body.campaigns);
        else setLoadError(body.error || "Could not load campaigns.");
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : "Could not load campaigns.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (term && !c.name.toLowerCase().includes(term) && !(c.book_title ?? "").toLowerCase().includes(term)) return false;
      return true;
    });
  }, [campaigns, search, statusFilter]);

  const liveCount = useMemo(() => campaigns.filter((c) => c.status === "live" || c.status === "exported").length, [campaigns]);
  const totalBudget = useMemo(() => campaigns.reduce((sum, c) => sum + c.daily_budget, 0), [campaigns]);
  const totalSpend = useMemo(() => campaigns.reduce((sum, c) => sum + c.spend, 0), [campaigns]);
  const avgAcos = useMemo(() => {
    const withAcos = campaigns.filter((c) => c.acos !== null);
    if (withAcos.length === 0) return null;
    return withAcos.reduce((sum, c) => sum + (c.acos ?? 0), 0) / withAcos.length;
  }, [campaigns]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle mt-1">Every campaign running across all books.</p>
        </div>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load campaigns</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading campaigns">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="empty-state">
            <span className="icon-tile icon-tile-lg icon-tile-dark">
              <Megaphone size={24} />
            </span>
            <p className="empty-state-title">No campaigns yet</p>
            <p className="empty-state-body">Create a campaign from a book&apos;s page to see it here.</p>
          </div>
        ) : (
          <>
            <StatTilesRow
              tiles={[
                { label: "Live campaigns", value: liveCount, icon: Radio },
                { label: "Daily budget", value: `$${totalBudget.toFixed(2)}`, icon: DollarSign },
                { label: "Total spend", value: `$${totalSpend.toFixed(2)}`, icon: Megaphone },
                { label: "Avg. ACOS", value: avgAcos === null ? "—" : `${(avgAcos * 100).toFixed(0)}%`, icon: TrendingUp },
              ]}
            />

            <div className="table-wrap overflow-x-auto">
              <div
                className="flex flex-wrap items-center gap-3 border-b p-4"
                style={{ borderColor: "var(--line)", background: "var(--bg-subtle)" }}
              >
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search campaign or book"
                  aria-label="Search campaign or book"
                  className="input w-full sm:w-80"
                  style={{ background: "var(--panel)" }}
                />
                <div className="flex flex-wrap gap-1.5">
                  {STATUS_FILTERS.map((status) => (
                    <button
                      key={status}
                      type="button"
                      onClick={() => setStatusFilter(status)}
                      style={{
                        borderRadius: "var(--radius-md)",
                        padding: "6px 12px",
                        fontSize: "0.8125rem",
                        border: statusFilter === status ? "1px solid var(--primary-solid)" : "1px solid var(--line-strong)",
                        background: statusFilter === status ? "var(--primary-solid)" : "var(--panel)",
                        color: statusFilter === status ? "var(--primary-fg)" : "var(--text-ui)",
                      }}
                    >
                      {status === "all" ? "All" : labelForStatus(status)}
                    </button>
                  ))}
                </div>
              </div>

              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Campaign</th>
                    <th scope="col">Book</th>
                    <th scope="col">Daily budget</th>
                    <th scope="col">Spend</th>
                    <th scope="col">ACOS</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <Link href={`/campaigns/${row.id}`} className="cell-primary">
                          {row.name}
                        </Link>
                        {row.last_export_error && (
                          <span className="badge badge-error ml-2" title={row.last_export_error}>
                            export failed
                          </span>
                        )}
                      </td>
                      <td>
                        {row.book_id && (
                          <Link href={`/books/${row.book_id}`} className="chip-tag-accent">
                            {row.book_title ?? "Book"}
                          </Link>
                        )}
                      </td>
                      <td>${row.daily_budget.toFixed(2)}</td>
                      <td>${row.spend.toFixed(2)}</td>
                      <td>{row.acos === null ? "—" : `${(row.acos * 100).toFixed(0)}%`}</td>
                      <td>
                        <span className={`badge ${STATUS_BADGE[row.status] ?? "badge-gray"}`}>
                          {labelForStatus(row.status)}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={6} className="meta-line">
                        No campaigns match this filter.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
