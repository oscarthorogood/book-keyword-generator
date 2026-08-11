"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search, Swords } from "lucide-react";
import Link from "next/link";
import type { AggregatedCompetitorRow } from "@/lib/allCompetitorsAggregate";

interface BookRef {
  id: string;
  title: string;
}

const PAGE_SIZE = 100;

function labelForSource(source: string): string {
  return source.replace(/-/g, " ");
}

function isSharedAcrossBooks(row: AggregatedCompetitorRow): boolean {
  return row.books.length > 1;
}

async function fetchAllCompetitors(): Promise<{
  books: BookRef[];
  competitors: AggregatedCompetitorRow[];
  error: string | null;
}> {
  try {
    const res = await fetch("/api/competitors/all");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { books: [], competitors: [], error: body.error || "Could not load competitor ASINs." };
    return { books: body.books ?? [], competitors: body.competitors ?? [], error: null };
  } catch (err) {
    return {
      books: [],
      competitors: [],
      error: err instanceof Error ? err.message : "Could not load competitor ASINs.",
    };
  }
}

/**
 * Global competitor-ASIN list across every book (competitor-ASIN
 * enhancements task 3) — mirrors AllKeywordsPage.tsx exactly (aggregate
 * cross-book table, search, filter chips), read-only, linking through to
 * each book's own Competitors tab where the ASIN is actually managed.
 */
export default function CompetitorsOverviewPage() {
  const [books, setBooks] = useState<BookRef[]>([]);
  const [competitors, setCompetitors] = useState<AggregatedCompetitorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [bookFilter, setBookFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [sharedOnly, setSharedOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let active = true;
    fetchAllCompetitors().then(({ books: loadedBooks, competitors: loadedCompetitors, error }) => {
      if (!active) return;
      setBooks(loadedBooks);
      setCompetitors(loadedCompetitors);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const statuses = useMemo(() => Array.from(new Set(competitors.flatMap((c) => c.statuses))).sort(), [competitors]);
  const sources = useMemo(() => Array.from(new Set(competitors.flatMap((c) => c.sources))).sort(), [competitors]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return competitors.filter((c) => {
      if (
        term &&
        !c.competitorAsin.toLowerCase().includes(term) &&
        !c.title?.toLowerCase().includes(term) &&
        !c.author?.toLowerCase().includes(term)
      ) {
        return false;
      }
      if (bookFilter !== "all" && !c.books.some((b) => b.bookId === bookFilter)) return false;
      if (statusFilter !== "all" && !c.statuses.includes(statusFilter)) return false;
      if (sourceFilter !== "all" && !c.sources.includes(sourceFilter)) return false;
      if (sharedOnly && !isSharedAcrossBooks(c)) return false;
      return true;
    });
  }, [competitors, search, bookFilter, statusFilter, sourceFilter, sharedOnly]);

  const sharedCount = useMemo(() => competitors.filter(isSharedAcrossBooks).length, [competitors]);

  const page = filtered.slice(0, visibleCount);

  function resetPaging() {
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Competitors</h1>
          <p className="page-subtitle mt-1">
            {competitors.length} unique competitor ASIN{competitors.length === 1 ? "" : "s"} across {books.length}{" "}
            book{books.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load competitor ASINs</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading competitor ASINs">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : competitors.length === 0 ? (
          <div className="empty-state">
            <span className="icon-tile icon-tile-lg icon-tile-dark">
              <Swords size={24} />
            </span>
            <p className="empty-state-title">No competitor ASINs yet</p>
            <p className="empty-state-body">Generate or add competitor ASINs on a book to see them here.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search size={20} className="input-icon" aria-hidden="true" />
                <label className="sr-only" htmlFor="all-competitors-search">
                  Search competitor ASINs
                </label>
                <input
                  id="all-competitors-search"
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    resetPaging();
                  }}
                  placeholder="Search ASIN, title or author"
                  className="input input-with-icon"
                />
              </div>

              <select
                value={bookFilter}
                onChange={(e) => {
                  setBookFilter(e.target.value);
                  resetPaging();
                }}
                className="input w-auto"
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

              <select
                value={sourceFilter}
                onChange={(e) => {
                  setSourceFilter(e.target.value);
                  resetPaging();
                }}
                className="input w-auto"
                aria-label="Filter by source"
              >
                <option value="all">All sources</option>
                {sources.map((source) => (
                  <option key={source} value={source}>
                    {labelForSource(source)}
                  </option>
                ))}
              </select>

              {sharedCount > 0 && (
                <button
                  onClick={() => {
                    setSharedOnly((v) => !v);
                    resetPaging();
                  }}
                  className={`btn ${sharedOnly ? "btn-primary" : "btn-secondary"}`}
                  aria-pressed={sharedOnly}
                  title="Same competitor ASIN tracked on 2+ books"
                >
                  Shared across books ({sharedCount})
                </button>
              )}
            </div>

            <div className="table-wrap overflow-x-auto">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th scope="col">Competitor ASIN</th>
                    <th scope="col" className="hidden lg:table-cell">
                      Title / author
                    </th>
                    <th scope="col">Books</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="hidden xl:table-cell">
                      Price
                    </th>
                    <th scope="col" className="hidden xl:table-cell">
                      BSR
                    </th>
                    <th scope="col" className="hidden xl:table-cell">
                      Source
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {page.map((row) => (
                    <tr key={row.key}>
                      <td>
                        <p className="cell-primary">
                          {row.competitorAsin}
                          {isSharedAcrossBooks(row) && (
                            <span
                              className="badge badge-warning ml-2"
                              title="Tracked on 2+ books in this account"
                            >
                              Shared
                            </span>
                          )}
                        </p>
                      </td>
                      <td className="hidden lg:table-cell">
                        {row.title || row.author ? (
                          <>
                            {row.title && <p className="cell-primary">{row.title}</p>}
                            {row.author && <p className="meta-line text-xs">{row.author}</p>}
                          </>
                        ) : (
                          <span style={{ color: "var(--text-placeholder)" }}>—</span>
                        )}
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {row.books.map((b) => (
                            <Link key={b.bookId} href={`/books/${b.bookId}?view=competitors`} className="chip-tag" title={b.status}>
                              {b.bookTitle}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td>{row.statuses.join(", ")}</td>
                      <td className="hidden xl:table-cell">
                        {row.price !== null ? `$${row.price.toFixed(2)}` : "—"}
                      </td>
                      <td className="hidden xl:table-cell">{row.bsr !== null ? row.bsr.toLocaleString() : "—"}</td>
                      <td className="hidden xl:table-cell">{row.sources.map(labelForSource).join(", ")}</td>
                    </tr>
                  ))}
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
