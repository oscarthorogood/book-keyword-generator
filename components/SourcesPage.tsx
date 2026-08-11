"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import type { SourceUsageRow } from "@/app/api/sources/route";

type UsedForFilter = "all" | "keywords" | "competitors";

async function fetchSources(): Promise<{ sources: SourceUsageRow[]; error: string | null }> {
  try {
    const res = await fetch("/api/sources");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { sources: [], error: body.error || "Could not load sources." };
    return { sources: body.sources ?? [], error: null };
  } catch (err) {
    return { sources: [], error: err instanceof Error ? err.message : "Could not load sources." };
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/**
 * Sources page (sidebar): every data source the keyword and competitor-ASIN
 * generation pipelines can draw on (lib/sourceRegistry.ts), whether it's
 * configured, and how much it's actually contributed — counted from the
 * `source` column already persisted on `keywords` and `competitor_asins`
 * (app/api/sources/route.ts), same aggregation style as the dashboard's
 * keyword-stats widget.
 */
export default function SourcesPage() {
  const [sources, setSources] = useState<SourceUsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [usedForFilter, setUsedForFilter] = useState<UsedForFilter>("all");
  const [configuredOnly, setConfiguredOnly] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSources().then(({ sources: loaded, error }) => {
      if (!active) return;
      setSources(loaded);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    return sources
      .filter((s) => usedForFilter === "all" || s.usedFor.includes(usedForFilter))
      .filter((s) => !configuredOnly || s.configured)
      .sort((a, b) => b.keywordCount + b.competitorCount - (a.keywordCount + a.competitorCount));
  }, [sources, usedForFilter, configuredOnly]);

  const configuredCount = sources.filter((s) => s.configured).length;
  const activeCount = sources.filter((s) => s.keywordCount > 0 || s.competitorCount > 0).length;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Sources</h1>
          <p className="page-subtitle mt-1">
            {loading
              ? "Loading…"
              : `${sources.length} data source${sources.length === 1 ? "" : "s"} — ${configuredCount} configured, ${activeCount} with usage`}
          </p>
        </div>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p>{loadError}</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border" style={{ borderColor: "var(--line)" }}>
                {(["all", "keywords", "competitors"] as UsedForFilter[]).map((option) => (
                  <button
                    key={option}
                    onClick={() => setUsedForFilter(option)}
                    className="px-3 py-1.5 text-sm capitalize"
                    style={{
                      background: usedForFilter === option ? "var(--bg-muted)" : "transparent",
                      fontWeight: usedForFilter === option ? 600 : 400,
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={configuredOnly}
                  onChange={(e) => setConfiguredOnly(e.target.checked)}
                />
                Configured only
              </label>
            </div>

            <div className="table-wrap overflow-x-auto">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Used for</th>
                    <th scope="col">Status</th>
                    <th scope="col">Keywords</th>
                    <th scope="col">Competitor ASINs</th>
                    <th scope="col">Last used</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="skeleton h-6 w-full" />
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="meta-line">
                        No sources match this filter.
                      </td>
                    </tr>
                  ) : (
                    filtered.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <div className="font-medium" style={{ color: "var(--text-primary)" }}>
                            {s.label}
                          </div>
                          <div className="meta-line text-xs">{s.description}</div>
                        </td>
                        <td>
                          <div className="flex gap-1">
                            {s.usedFor.map((kind) => (
                              <span key={kind} className="chip-tag capitalize">
                                {kind}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td>
                          {s.configured ? (
                            <span className="badge badge-success inline-flex items-center gap-1">
                              <CheckCircle2 size={14} /> Configured
                            </span>
                          ) : s.configEnvVar ? (
                            <span
                              className="badge badge-gray inline-flex items-center gap-1"
                              title={`Set ${s.configEnvVar} to enable this source.`}
                            >
                              <XCircle size={14} /> Needs {s.configEnvVar}
                            </span>
                          ) : (
                            <span className="badge badge-success inline-flex items-center gap-1">
                              <CheckCircle2 size={14} /> No key needed
                            </span>
                          )}
                        </td>
                        <td className="tabular-nums">{s.keywordCount.toLocaleString()}</td>
                        <td className="tabular-nums">{s.competitorCount.toLocaleString()}</td>
                        <td className="meta-line text-xs">{formatDate(s.lastUsedAt)}</td>
                      </tr>
                    ))
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
