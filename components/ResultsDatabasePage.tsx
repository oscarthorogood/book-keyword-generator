"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";

interface BookRef {
  id: string;
  title: string;
}

interface ResultImport {
  id: string;
  bookId: string;
  bookTitle: string;
  sourceFile: string;
  reportStart: string;
  reportEnd: string;
  rowCount: number | null;
  matchedCount: number | null;
  unmatchedCount: number | null;
  status: string;
  error: string | null;
  createdAt: string;
  currency: string | null;
  totals: { clicks: number; impressions: number; spend: number; sales: number; orders: number };
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function money(amount: number, currency: string | null): string {
  return currency ? `${currency} ${amount.toFixed(2)}` : amount.toFixed(2);
}

async function fetchImports(): Promise<{ books: BookRef[]; imports: ResultImport[]; error: string | null }> {
  try {
    const res = await fetch("/api/results/all");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { books: [], imports: [], error: body.error || "Could not load results." };
    return { books: body.books ?? [], imports: body.imports ?? [], error: null };
  } catch (err) {
    return { books: [], imports: [], error: err instanceof Error ? err.message : "Could not load results." };
  }
}

/**
 * The Results database: every Search Term Report uploaded, across every
 * book, with the performance it carried.
 *
 * Uploading still happens on the book itself (that's where the report
 * belongs); this is the record of what has been fed in, so it's clear which
 * books are updating against real data and which are running on estimates.
 */
export default function ResultsDatabasePage() {
  const [books, setBooks] = useState<BookRef[]>([]);
  const [imports, setImports] = useState<ResultImport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [bookFilter, setBookFilter] = useState<"all" | string>("all");

  useEffect(() => {
    let active = true;
    fetchImports().then(({ books: loadedBooks, imports: loadedImports, error }) => {
      if (!active) return;
      setBooks(loadedBooks);
      setImports(loadedImports);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(
    () => (bookFilter === "all" ? imports : imports.filter((row) => row.bookId === bookFilter)),
    [imports, bookFilter]
  );

  const totals = useMemo(
    () =>
      filtered.reduce(
        (sum, row) => ({
          spend: sum.spend + row.totals.spend,
          sales: sum.sales + row.totals.sales,
          orders: sum.orders + row.totals.orders,
        }),
        { spend: 0, sales: 0, orders: 0 }
      ),
    [filtered]
  );
  const currency = filtered.find((row) => row.currency)?.currency ?? null;

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header">
        <h1 className="page-title">Results</h1>
        <p className="page-subtitle mt-1">
          {imports.length} report{imports.length === 1 ? "" : "s"} imported across {books.length} book
          {books.length === 1 ? "" : "s"}
        </p>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load results</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading results">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : imports.length === 0 ? (
          <div className="empty-state">
            <div className="space-y-1">
              <p className="empty-state-title">No results imported yet</p>
              <p className="empty-state-body">
                Open a book and use “Upload results” to import an Amazon Search Term Report. Campaign updates then
                weigh real performance instead of estimated bids.
              </p>
            </div>
            <Link href="/books" className="btn btn-primary">
              Go to books
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <select
                value={bookFilter}
                onChange={(e) => setBookFilter(e.target.value)}
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

              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {money(totals.spend, currency)} spend · {money(totals.sales, currency)} sales · {totals.orders} orders
              </p>
            </div>

            <div className="table-wrap overflow-x-auto">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th scope="col">Report</th>
                    <th scope="col">Book</th>
                    <th scope="col">Period</th>
                    <th scope="col">Rows matched</th>
                    <th scope="col">Spend</th>
                    <th scope="col">Sales</th>
                    <th scope="col">Orders</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <p className="cell-primary truncate">{row.sourceFile}</p>
                        <p className="meta-line">Imported {formatDate(row.createdAt)}</p>
                      </td>
                      <td>
                        <Link href={`/books/${row.bookId}`} className="chip-tag">
                          {row.bookTitle}
                        </Link>
                      </td>
                      <td>
                        {formatDate(row.reportStart)} – {formatDate(row.reportEnd)}
                      </td>
                      <td>
                        {row.matchedCount ?? 0}
                        {row.rowCount ? ` / ${row.rowCount}` : ""}
                        {/* Unmatched rows are search terms with no target in this book's
                            campaigns — normal for broad match, worth seeing all the same. */}
                        {row.unmatchedCount ? <span className="meta-line"> · {row.unmatchedCount} unmatched</span> : null}
                      </td>
                      <td>{money(row.totals.spend, row.currency)}</td>
                      <td>{money(row.totals.sales, row.currency)}</td>
                      <td>{row.totals.orders}</td>
                      <td>
                        {row.status === "failed" ? (
                          <span className="badge badge-error" title={row.error ?? undefined}>
                            Failed
                          </span>
                        ) : row.status === "complete" ? (
                          <span className="badge badge-gray">Imported</span>
                        ) : (
                          <span className="badge badge-gray">{row.status}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
