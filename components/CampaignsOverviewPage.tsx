"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Megaphone } from "lucide-react";
import Link from "next/link";

interface CampaignRow {
  id: string;
  book_id: string;
  export_batch_id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  currency: string;
  status: string;
  amazon_campaign_id: string | null;
  operation: string;
  updated_at: string;
  book_title: string | null;
  book_author: string | null;
}

function labelForType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Cross-book campaigns list (campaigns spec §7) — every sub-campaign of
 * every book's 5-campaign structure, grouped by `export_batch_id` (one
 * Create Campaign run). Mirrors CompetitorsOverviewPage.tsx's read-only
 * aggregate-table shape; links through to the book (edit) and to
 * `/campaigns/[id]` (export history, results, recommendations).
 */
export default function CampaignsOverviewPage() {
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");

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

  const statuses = useMemo(() => Array.from(new Set(campaigns.map((c) => c.status))).sort(), [campaigns]);

  const filtered = useMemo(
    () => (statusFilter === "all" ? campaigns : campaigns.filter((c) => c.status === statusFilter)),
    [campaigns, statusFilter]
  );

  const batches = useMemo(() => {
    const order: string[] = [];
    const byBatch = new Map<string, CampaignRow[]>();
    for (const row of filtered) {
      if (!byBatch.has(row.export_batch_id)) {
        byBatch.set(row.export_batch_id, []);
        order.push(row.export_batch_id);
      }
      byBatch.get(row.export_batch_id)!.push(row);
    }
    return order.map((batchId) => ({ batchId, rows: byBatch.get(batchId)! }));
  }, [filtered]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Campaigns</h1>
          <p className="page-subtitle mt-1">
            {campaigns.length} sub-campaign{campaigns.length === 1 ? "" : "s"} across{" "}
            {new Set(campaigns.map((c) => c.book_id)).size} book{new Set(campaigns.map((c) => c.book_id)).size === 1 ? "" : "s"}
          </p>
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
            <p className="empty-state-body">Create a campaign from a book&apos;s keyword page to see it here.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="input w-auto"
                aria-label="Filter by status"
              >
                <option value="all">Any status</option>
                {statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-6">
              {batches.map(({ batchId, rows }) => (
                <div key={batchId} className="table-wrap overflow-x-auto">
                  <table className="table table-dense">
                    <thead>
                      <tr>
                        <th scope="col">Campaign</th>
                        <th scope="col">Book</th>
                        <th scope="col">Type</th>
                        <th scope="col">Budget</th>
                        <th scope="col">Status</th>
                        <th scope="col">Amazon ID</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <Link href={`/campaigns/${row.id}`} className="cell-primary">
                              {row.name}
                            </Link>
                          </td>
                          <td>
                            {row.book_id && (
                              <Link href={`/books/${row.book_id}`} className="chip-tag">
                                {row.book_title ?? "Book"}
                              </Link>
                            )}
                          </td>
                          <td>{labelForType(row.campaign_type)}</td>
                          <td>
                            {row.daily_budget.toFixed(2)} {row.currency}/day
                          </td>
                          <td>{row.status}</td>
                          <td>
                            {row.amazon_campaign_id ?? (
                              <span className="badge badge-warning">needs Amazon ID</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
