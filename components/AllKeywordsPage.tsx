"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import Link from "next/link";
import type { AggregatedKeywordRow } from "@/lib/allKeywordsAggregate";

interface BookRef {
  id: string;
  title: string;
}

const PAGE_SIZE = 100;
const SPECIFICITY_LABELS: Record<number, string> = {
  1: "Broad",
  2: "Somewhat broad",
  3: "Medium",
  4: "Somewhat specific",
  5: "Very specific",
};

function labelForSource(source: string): string {
  return source.replace(/-/g, " ");
}

async function fetchAllKeywords(): Promise<{
  books: BookRef[];
  keywords: AggregatedKeywordRow[];
  error: string | null;
}> {
  try {
    const res = await fetch("/api/keywords/all");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { books: [], keywords: [], error: body.error || "Could not load keywords." };
    return { books: body.books ?? [], keywords: body.keywords ?? [], error: null };
  } catch (err) {
    return { books: [], keywords: [], error: err instanceof Error ? err.message : "Could not load keywords." };
  }
}

/** Global keyword list across every book (Enhancements spec §4) — read-only, links into each book's own manager. */
export default function AllKeywordsPage() {
  const [books, setBooks] = useState<BookRef[]>([]);
  const [keywords, setKeywords] = useState<AggregatedKeywordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [bookFilter, setBookFilter] = useState<"all" | string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | string>("all");
  const [sourceFilter, setSourceFilter] = useState<"all" | string>("all");
  const [specificityFilter, setSpecificityFilter] = useState<"all" | number>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    let active = true;
    fetchAllKeywords().then(({ books: loadedBooks, keywords: loadedKeywords, error }) => {
      if (!active) return;
      setBooks(loadedBooks);
      setKeywords(loadedKeywords);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const statuses = useMemo(() => Array.from(new Set(keywords.flatMap((k) => k.statuses))).sort(), [keywords]);
  const sources = useMemo(() => Array.from(new Set(keywords.flatMap((k) => k.sources))).sort(), [keywords]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return keywords.filter((k) => {
      if (term && !k.text.toLowerCase().includes(term)) return false;
      if (bookFilter !== "all" && !k.books.some((b) => b.bookId === bookFilter)) return false;
      if (statusFilter !== "all" && !k.statuses.includes(statusFilter)) return false;
      if (sourceFilter !== "all" && !k.sources.includes(sourceFilter)) return false;
      if (specificityFilter !== "all" && !k.specificities.includes(specificityFilter)) return false;
      return true;
    });
  }, [keywords, search, bookFilter, statusFilter, sourceFilter, specificityFilter]);

  const page = filtered.slice(0, visibleCount);

  function resetPaging() {
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Keywords</h1>
          <p className="page-subtitle mt-1">
            {keywords.length} unique keyword{keywords.length === 1 ? "" : "s"} across {books.length} book
            {books.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load keywords</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading keywords">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : keywords.length === 0 ? (
          <div className="empty-state">
            <p>No keywords yet — generate keywords on a book to see them here.</p>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1">
                <Search size={20} className="input-icon" aria-hidden="true" />
                <label className="sr-only" htmlFor="all-keywords-search">
                  Search keywords
                </label>
                <input
                  id="all-keywords-search"
                  type="search"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    resetPaging();
                  }}
                  placeholder="Search keywords"
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

              <select
                value={specificityFilter}
                onChange={(e) => {
                  setSpecificityFilter(e.target.value === "all" ? "all" : Number(e.target.value));
                  resetPaging();
                }}
                className="input w-auto"
                aria-label="Filter by specificity"
              >
                <option value="all">Any specificity</option>
                {[1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {SPECIFICITY_LABELS[level]}
                  </option>
                ))}
              </select>
            </div>

            <div className="table-wrap overflow-x-auto">
              <table className="table table-dense">
                <thead>
                  <tr>
                    <th scope="col">Keyword</th>
                    <th scope="col">Books</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="hidden lg:table-cell">
                      Match type
                    </th>
                    <th scope="col" className="hidden xl:table-cell">
                      Specificity
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
                        <p className="cell-primary">{row.text}</p>
                      </td>
                      <td>
                        <div className="flex flex-wrap gap-1">
                          {row.books.map((b) => (
                            <Link key={b.bookId} href={`/books/${b.bookId}`} className="chip-tag" title={b.status}>
                              {b.bookTitle}
                            </Link>
                          ))}
                        </div>
                      </td>
                      <td>{row.statuses.join(", ")}</td>
                      <td className="hidden lg:table-cell">{row.matchTypes.join(", ")}</td>
                      <td className="hidden xl:table-cell">
                        {row.maxSpecificity ? SPECIFICITY_LABELS[row.maxSpecificity] : "—"}
                      </td>
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
