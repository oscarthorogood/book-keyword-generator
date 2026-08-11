"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, BookOpen } from "lucide-react";
import Link from "next/link";
import type { RecentBookSummary } from "@/lib/dashboardStats";

/** Dashboard "Recent books" widget (Enhancements spec §2). Own fetch, fails soft. */
export default function RecentBooksWidget() {
  const [books, setBooks] = useState<RecentBookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch("/api/dashboard/recent-books")
      .then((res) => res.json().catch(() => ({})).then((body) => ({ res, body })))
      .then(({ res, body }) => {
        if (!active) return;
        if (!res.ok) setError(body.error || "Couldn't load recent books.");
        else setBooks(body.books);
      })
      .catch((err) => active && setError(err instanceof Error ? err.message : "Couldn't load recent books."))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="card p-5">
      <h2 className="text-md font-semibold" style={{ color: "var(--text-primary)" }}>
        Recent books
      </h2>
      {loading ? (
        <div className="skeleton mt-3 h-24 w-full" />
      ) : error ? (
        <div className="alert alert-error mt-3" role="alert">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      ) : !books || books.length === 0 ? (
        <p className="meta-line mt-3">No books yet.</p>
      ) : (
        <ul className="mt-3 divide-y" style={{ borderColor: "var(--line)" }}>
          {books.map((book) => (
            <li key={book.id} className="flex items-center gap-3 py-2">
              <div
                className="flex h-10 w-8 shrink-0 items-center justify-center overflow-hidden rounded"
                style={{ background: "var(--line)" }}
              >
                {book.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- external Amazon cover URLs, not a local asset
                  <img src={book.coverImageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <BookOpen size={16} style={{ color: "var(--icon-default)" }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/books/${book.id}`} className="cell-primary block truncate">
                  {book.title}
                </Link>
                <p className="meta-line truncate text-xs">{book.author}</p>
              </div>
              <span
                className={`badge ${
                  book.captureOk === false ? "badge-error" : book.captureOk === null ? "badge-gray" : "badge-success"
                }`}
                title={
                  book.completeness !== null ? `Capture completeness: ${Math.round(book.completeness * 100)}%` : undefined
                }
              >
                {book.captureOk === false ? "Capture issue" : book.captureOk === null ? "Unknown" : "Captured"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
