"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, CheckCircle2, Search, Tags } from "lucide-react";
import Link from "next/link";
import type { AggregatedKeywordRow } from "@/lib/allKeywordsAggregate";
import type { AggregatedCompetitorRow } from "@/lib/allCompetitorsAggregate";
import { isCannibalized } from "@/lib/cannibalization";
import { StatTilesRow } from "./StatTiles";

const KIND_FILTERS = [
  { key: "all", label: "All" },
  { key: "keyword", label: "Keywords" },
  { key: "asin", label: "ASINs" },
] as const;

interface BookRef {
  id: string;
  title: string;
}

/** One row of the combined table — a keyword or an ASIN, flattened to the same shape. */
interface TargetRow {
  key: string;
  kind: "keyword" | "asin";
  /** The keyword text, or the ASIN. */
  target: string;
  /** Product title for an ASIN; the match types for a keyword. */
  detail: string;
  books: Array<{ bookId: string; bookTitle: string }>;
  statuses: string[];
  sources: string[];
  /** Only keywords carry a specificity score. */
  specificity: number | null;
  /** Only keywords can cannibalise each other across books. */
  shared: boolean;
}

const PAGE_SIZE = 100;

function labelForSource(source: string): string {
  return source.replace(/-/g, " ");
}

function keywordToRow(row: AggregatedKeywordRow): TargetRow {
  return {
    key: `keyword:${row.key}`,
    kind: "keyword",
    target: row.text,
    detail: row.matchTypes.join(", "),
    books: row.books.map((b) => ({ bookId: b.bookId, bookTitle: b.bookTitle })),
    statuses: row.statuses,
    sources: row.sources,
    specificity: row.maxSpecificity,
    shared: isCannibalized(row),
  };
}

function competitorToRow(row: AggregatedCompetitorRow): TargetRow {
  return {
    key: `asin:${row.key}`,
    kind: "asin",
    target: row.competitorAsin,
    detail: [row.title, row.author].filter(Boolean).join(" — "),
    books: row.books.map((b) => ({ bookId: b.bookId, bookTitle: b.bookTitle })),
    statuses: row.statuses,
    sources: row.sources,
    specificity: null,
    shared: false,
  };
}

async function fetchTargets(): Promise<{ books: BookRef[]; rows: TargetRow[]; error: string | null }> {
  try {
    const [keywordRes, asinRes] = await Promise.all([fetch("/api/keywords/all"), fetch("/api/competitors/all")]);
    const [keywordBody, asinBody] = await Promise.all([
      keywordRes.json().catch(() => ({})),
      asinRes.json().catch(() => ({})),
    ]);

    // Half a table is worse than an honest error — if either side failed,
    // say so rather than quietly showing keywords with no ASINs.
    if (!keywordRes.ok || !asinRes.ok) {
      return {
        books: [],
        rows: [],
        error: keywordBody.error || asinBody.error || "Could not load keywords and ASINs.",
      };
    }

    const rows = [
      ...((keywordBody.keywords ?? []) as AggregatedKeywordRow[]).map(keywordToRow),
      ...((asinBody.competitors ?? []) as AggregatedCompetitorRow[]).map(competitorToRow),
    ];

    // Both routes return the same book list; either is fine.
    return { books: (keywordBody.books ?? asinBody.books ?? []) as BookRef[], rows, error: null };
  } catch (err) {
    return { books: [], rows: [], error: err instanceof Error ? err.message : "Could not load keywords and ASINs." };
  }
}

/**
 * The single Keywords/ASINs database.
 *
 * These were two separate pages backed by two separate aggregates. They show
 * the same thing — a target, which books use it, its status and where it came
 * from — so they are one table now, with a Type filter instead of a tab.
 *
 * Read-only by design: targets are produced and curated by campaign
 * generation (lib/campaignPrepare.ts), not edited by hand. This is the
 * record of what generation found, and the link back to the book it was
 * found for.
 */
export default function TargetsDatabasePage() {
  const [books, setBooks] = useState<BookRef[]>([]);
  const [rows, setRows] = useState<TargetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "keyword" | "asin">("all");
  const [bookFilter, setBookFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let active = true;
    fetchTargets().then(({ books: loadedBooks, rows: loadedRows, error }) => {
      if (!active) return;
      setBooks(loadedBooks);
      setRows(loadedRows);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const statuses = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.statuses))).sort(), [rows]);
  const sources = useMemo(() => Array.from(new Set(rows.flatMap((r) => r.sources))).sort(), [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (kindFilter !== "all" && row.kind !== kindFilter) return false;
      if (term && !row.target.toLowerCase().includes(term) && !row.detail.toLowerCase().includes(term)) return false;
      if (bookFilter !== "all" && !row.books.some((b) => b.bookId === bookFilter)) return false;
      if (statusFilter !== "all" && !row.statuses.includes(statusFilter)) return false;
      if (sourceFilter !== "all" && !row.sources.includes(sourceFilter)) return false;
      return true;
    });
  }, [rows, search, kindFilter, bookFilter, statusFilter, sourceFilter]);

  const keywordCount = useMemo(() => rows.filter((r) => r.kind === "keyword").length, [rows]);
  const asinCount = rows.length - keywordCount;
  const page = filtered.slice(0, visibleCount);

  function resetPaging() {
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header">
        <h1 className="page-title">Keywords &amp; ASINs</h1>
        <p className="page-subtitle mt-1">
          {keywordCount} keyword{keywordCount === 1 ? "" : "s"} and {asinCount} competitor ASIN
          {asinCount === 1 ? "" : "s"} found across {books.length} book{books.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load keywords and ASINs</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading keywords and ASINs">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <div className="space-y-1">
              <p className="empty-state-title">Nothing here yet</p>
              <p className="empty-state-body">
                Keywords and competitor ASINs are found automatically when you create campaigns for a book. Create
                campaigns on a book and they will appear here.
              </p>
            </div>
            <Link href="/books" className="btn btn-primary">
              Go to books
            </Link>
          </div>
        ) : (
          <>
            <StatTilesRow
              tiles={[
                { label: "Total researched", value: rows.length, icon: Tags },
                { label: "Keywords", value: keywordCount, icon: Search },
                { label: "ASINs", value: asinCount, icon: Boxes },
                { label: "Live", value: rows.filter((r) => r.statuses.includes("active")).length, icon: CheckCircle2 },
              ]}
            />

            <div className="table-wrap overflow-x-auto">
              <div
                className="flex flex-wrap items-center gap-3 border-b p-4"
                style={{ borderColor: "var(--line)", background: "var(--bg-subtle)" }}
              >
                <div className="relative w-full sm:w-80">
                  <Search size={20} className="input-icon" aria-hidden="true" />
                  <label className="sr-only" htmlFor="targets-search">
                    Search keywords and ASINs
                  </label>
                  <input
                    id="targets-search"
                    type="search"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      resetPaging();
                    }}
                    placeholder="Search keyword, ASIN or title"
                    className="input input-with-icon"
                    style={{ background: "var(--panel)" }}
                  />
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {KIND_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => {
                        setKindFilter(f.key);
                        resetPaging();
                      }}
                      style={{
                        borderRadius: "var(--radius-md)",
                        padding: "6px 12px",
                        fontSize: "0.8125rem",
                        fontWeight: 600,
                        cursor: "pointer",
                        border: kindFilter === f.key ? "1px solid var(--primary-solid)" : "1px solid var(--line-strong)",
                        background: kindFilter === f.key ? "var(--primary-solid)" : "var(--panel)",
                        color: kindFilter === f.key ? "var(--primary-fg)" : "var(--text-ui)",
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <select
                  value={bookFilter}
                  onChange={(e) => {
                    setBookFilter(e.target.value);
                    resetPaging();
                  }}
                  className="input input-sm w-auto"
                  aria-label="Filter by book"
                >
                  <option value="all">All books</option>
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {book.title}
                    </option>
                  ))}
                </select>

                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    resetPaging();
                  }}
                  className="input input-sm w-auto"
                  aria-label="Filter by status"
                >
                  <option value="all">Any status</option>
                  {statuses.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>

                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value);
                    resetPaging();
                  }}
                  className="input input-sm w-auto"
                  aria-label="Filter by source"
                >
                  <option value="all">All sources</option>
                  {sources.map((source) => (
                    <option key={source} value={source}>
                      {labelForSource(source)}
                    </option>
                  ))}
                </select>

                <p className="ml-auto text-sm" style={{ color: "var(--text-secondary)" }}>
                  Showing {Math.min(page.length, filtered.length)} of {filtered.length}
                </p>
              </div>

              <table className="table table-dense">
                <thead>
                  <tr>
                    <th scope="col">Term / ASIN</th>
                    <th scope="col">Type</th>
                    <th scope="col">Books</th>
                    <th scope="col">Relevance</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="hidden xl:table-cell">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((row) => {
                    const relevancePct = row.specificity !== null ? Math.round((row.specificity / 5) * 100) : null;
                    const relevanceColor =
                      relevancePct === null
                        ? "var(--line-strong)"
                        : relevancePct >= 80
                          ? "var(--color-success-500)"
                          : relevancePct >= 60
                            ? "var(--accent)"
                            : "var(--color-warning-500)";
                    return (
                      <tr key={row.key}>
                        <td>
                          <p className="cell-primary">
                            <span className={row.kind === "asin" ? "font-mono" : undefined}>{row.target}</span>
                            {row.shared && (
                              <span
                                className="badge badge-warning ml-2"
                                title="Active on 2+ books — competes against itself in Amazon's auction"
                              >
                                Shared
                              </span>
                            )}
                          </p>
                          {row.detail && <p className="meta-line truncate">{row.detail}</p>}
                        </td>
                        <td>
                          <span className={`badge ${row.kind === "asin" ? "badge-brand" : "badge-gray"}`}>
                            {row.kind === "keyword" ? "Keyword" : "ASIN"}
                          </span>
                        </td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {row.books.map((b) => (
                              <Link key={b.bookId} href={`/books/${b.bookId}`} className="chip-tag">
                                {b.bookTitle}
                              </Link>
                            ))}
                          </div>
                        </td>
                        <td>
                          {relevancePct === null ? (
                            <span style={{ color: "var(--text-placeholder)" }}>—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div style={{ width: 60, height: 6, borderRadius: 9999, background: "var(--bg-muted)", overflow: "hidden" }}>
                                <div style={{ width: `${relevancePct}%`, height: "100%", background: relevanceColor }} />
                              </div>
                              <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
                                {relevancePct}%
                              </span>
                            </div>
                          )}
                        </td>
                        <td>{row.statuses.join(", ")}</td>
                        <td className="hidden xl:table-cell">{row.sources.map(labelForSource).join(", ")}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {visibleCount < filtered.length && (
              <div className="mt-4 flex justify-center">
                <button onClick={() => setVisibleCount((n) => n + PAGE_SIZE)} className="btn btn-secondary">
                  Load more ({filtered.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
