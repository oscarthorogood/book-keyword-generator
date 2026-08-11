"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Swords } from "lucide-react";
import Link from "next/link";

interface BookCompetitorSummary {
  bookId: string;
  bookTitle: string;
  bookAuthor: string;
  competitorAsinCount: number;
  competitorKeywordCount: number;
}

async function fetchSummary(): Promise<{ books: BookCompetitorSummary[]; error: string | null }> {
  try {
    const res = await fetch("/api/competitors/summary");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { books: [], error: body.error || "Could not load competitor stats." };
    return { books: body.books ?? [], error: null };
  } catch (err) {
    return { books: [], error: err instanceof Error ? err.message : "Could not load competitor stats." };
  }
}

/**
 * Global competitors overview (spec §5.2) — the same page-shell pattern as
 * app/keywords/page.tsx's AllKeywordsPage: per-book competitor-ASIN and
 * competitor-keyword counts, linking through to each book's own
 * Competitors tab (BookKeywordPanel mode="competitors").
 */
export default function CompetitorsOverviewPage() {
  const [books, setBooks] = useState<BookCompetitorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchSummary().then(({ books: loaded, error }) => {
      if (!active) return;
      setBooks(loaded);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const totalAsins = books.reduce((sum, b) => sum + b.competitorAsinCount, 0);
  const totalKeywords = books.reduce((sum, b) => sum + b.competitorKeywordCount, 0);

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Competitors</h1>
          <p className="page-subtitle mt-1">
            {totalAsins} competitor ASIN{totalAsins === 1 ? "" : "s"} · {totalKeywords} competitor keyword
            {totalKeywords === 1 ? "" : "s"} across {books.length} book{books.length === 1 ? "" : "s"}
          </p>
        </div>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load competitor stats</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading competitor stats">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-4 w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : books.length === 0 ? (
          <div className="empty-state">
            <span className="icon-tile icon-tile-lg icon-tile-dark">
              <Swords size={24} />
            </span>
            <p className="empty-state-title">No books yet</p>
            <p className="empty-state-body">Add a book first, then attach competitor ASINs from its page.</p>
          </div>
        ) : (
          <div className="table-wrap overflow-x-auto">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th scope="col">Book</th>
                  <th scope="col">Competitor ASINs</th>
                  <th scope="col">Competitor keywords</th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => (
                  <tr key={book.bookId}>
                    <td>
                      <p className="cell-primary">{book.bookTitle}</p>
                      <p className="meta-line text-xs">{book.bookAuthor}</p>
                    </td>
                    <td>{book.competitorAsinCount}</td>
                    <td>{book.competitorKeywordCount}</td>
                    <td className="text-right">
                      <Link href={`/books/${book.bookId}?view=competitors`} className="btn btn-secondary btn-sm">
                        View competitors
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
