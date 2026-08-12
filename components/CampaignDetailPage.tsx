"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import RecommendationsPanel from "./RecommendationsPanel";

interface Campaign {
  id: string;
  book_id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  currency: string;
  status: string;
  amazon_campaign_id: string | null;
  operation: string;
  export_batch_id: string;
  bulksheet_download_url: string | null;
  updated_at: string;
}

interface Book {
  id: string;
  title: string;
  author: string;
}

interface Target {
  id: string;
  target_text: string;
  match_type: string | null;
  targeting_expression: string | null;
  bid: number | null;
  state: string;
  operation: string;
  is_negative: boolean;
  negative_scope: string | null;
  created_at: string;
}

interface Result {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  report_start: string;
  report_end: string;
}

interface Totals {
  impressions: number;
  clicks: number;
  spend: number;
  sales: number;
  orders: number;
  acos: number | null;
}

/**
 * One sub-campaign: export history, results, scoped recommendations
 * (campaigns spec §7). Read-only detail view — Update Campaign itself
 * still lives on the book's keyword page (CampaignActions.tsx), since
 * that's where the live keyword/ASIN bank being diffed against is edited.
 */
export default function CampaignDetailPage({ campaignId }: { campaignId: string }) {
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [book, setBook] = useState<Book | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/campaigns/${campaignId}`)
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (!active) return;
        if (body.campaign) {
          setCampaign(body.campaign);
          setBook(body.book);
          setTargets(body.targets ?? []);
          setResults(body.results ?? []);
          setTotals(body.totals ?? null);
        } else {
          setLoadError(body.error || "Could not load campaign.");
        }
      })
      .catch((err) => {
        if (active) setLoadError(err instanceof Error ? err.message : "Could not load campaign.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [campaignId]);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link href="/campaigns" className="btn btn-tertiary btn-sm mb-2">
            <ArrowLeft size={14} /> All campaigns
          </Link>
          <h1 className="page-title">{campaign?.name ?? "Campaign"}</h1>
          {book && (
            <p className="page-subtitle mt-1">
              <Link href={`/books/${book.id}`} className="chip-tag">
                {book.title}
              </Link>{" "}
              by {book.author}
            </p>
          )}
        </div>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load campaign</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading campaign">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : campaign ? (
          <>
            <div className="card mb-6">
              <h2 className="text-md font-semibold mb-3">Overview</h2>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="meta-line text-xs">Budget</dt>
                  <dd className="cell-primary">
                    {campaign.daily_budget.toFixed(2)} {campaign.currency}/day
                  </dd>
                </div>
                <div>
                  <dt className="meta-line text-xs">Status</dt>
                  <dd className="cell-primary">{campaign.status}</dd>
                </div>
                <div>
                  <dt className="meta-line text-xs">Amazon Campaign ID</dt>
                  <dd className="cell-primary">
                    {campaign.amazon_campaign_id ?? <span className="badge badge-warning">needs Amazon ID</span>}
                  </dd>
                </div>
                <div>
                  <dt className="meta-line text-xs">Last export</dt>
                  <dd className="cell-primary">{new Date(campaign.updated_at).toLocaleString()}</dd>
                </div>
              </dl>
              {campaign.bulksheet_download_url && (
                <a href={campaign.bulksheet_download_url} className="btn btn-tertiary btn-sm mt-3">
                  Download latest bulksheet
                </a>
              )}
            </div>

            {totals && (
              <div className="card mb-6">
                <h2 className="text-md font-semibold mb-3">
                  Lifetime results <span className="meta-line">({results.length} report period{results.length === 1 ? "" : "s"})</span>
                </h2>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                  <div>
                    <dt className="meta-line text-xs">Spend</dt>
                    <dd className="cell-primary">${totals.spend.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="meta-line text-xs">Sales</dt>
                    <dd className="cell-primary">${totals.sales.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt className="meta-line text-xs">Orders</dt>
                    <dd className="cell-primary">{totals.orders}</dd>
                  </div>
                  <div>
                    <dt className="meta-line text-xs">Clicks</dt>
                    <dd className="cell-primary">{totals.clicks}</dd>
                  </div>
                  <div>
                    <dt className="meta-line text-xs">ACOS</dt>
                    <dd className="cell-primary">{totals.acos !== null ? `${(totals.acos * 100).toFixed(1)}%` : "—"}</dd>
                  </div>
                </dl>
              </div>
            )}

            <RecommendationsPanel bookId={campaign.book_id} campaignId={campaign.id} />

            <div className="table-wrap overflow-x-auto">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th scope="col">Target</th>
                    <th scope="col">Match type</th>
                    <th scope="col">Bid</th>
                    <th scope="col">State</th>
                    <th scope="col">Operation</th>
                    <th scope="col">Exported</th>
                  </tr>
                </thead>
                <tbody>
                  {targets.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <p className="cell-primary">{t.target_text}</p>
                        {t.is_negative && <span className="meta-line text-xs">negative ({t.negative_scope})</span>}
                      </td>
                      <td>{t.match_type ?? "—"}</td>
                      <td>{t.bid !== null ? `$${t.bid.toFixed(2)}` : "—"}</td>
                      <td>{t.state}</td>
                      <td>{t.operation}</td>
                      <td>{new Date(t.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
