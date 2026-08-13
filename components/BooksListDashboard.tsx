"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Plus, Search } from "lucide-react";

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  campaign_count: number;
  created_at: string;
  metadata_json?: {
    coverImageUrl?: string;
    genreTerms?: string[];
    capture?: { ok: boolean; blocked: boolean };
  } | null;
}

interface BooksListDashboardProps {
  onAddBook: () => void;
  onSelectBook: (bookId: string) => void;
}

/** Fetches without touching state, so effects never set state synchronously. */
async function fetchBooks(): Promise<{ books: Book[]; error: string | null }> {
  try {
    const res = await fetch("/api/books/list");
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { books: [], error: body.error || "Could not load your books." };
    return { books: body.books ?? [], error: null };
  } catch (err) {
    return { books: [], error: err instanceof Error ? err.message : "Could not load your books." };
  }
}

export default function BooksListDashboard({ onAddBook, onSelectBook }: BooksListDashboardProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    let active = true;
    fetchBooks().then(({ books: loaded, error }) => {
      if (!active) return;
      setBooks(loaded);
      setLoadError(error);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filteredBooks = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return books;
    return books.filter((book) =>
      [book.title, book.author, book.asin].some((field) => field?.toLowerCase().includes(term))
    );
  }, [books, searchTerm]);

  const totalCampaigns = useMemo(
    () => books.reduce((sum, book) => sum + (book.campaign_count ?? 0), 0),
    [books]
  );

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="page-title">Books</h1>
          <p className="page-subtitle mt-1">
            {books.length} book{books.length === 1 ? "" : "s"} · {totalCampaigns} campaign
            {totalCampaigns === 1 ? "" : "s"}
          </p>
        </div>
        <button onClick={onAddBook} className="btn btn-primary">
          <Plus size={20} />
          Add book
        </button>
      </header>

      <div className="page-body flex-1">
        {loadError ? (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Couldn&apos;t load your books</p>
              <p className="mt-1">{loadError}</p>
            </div>
          </div>
        ) : loading ? (
          <div className="table-wrap" aria-busy="true" aria-label="Loading books">
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              {[0, 1, 2].map((row) => (
                <div key={row} className="flex items-center gap-4 p-4">
                  <div className="skeleton h-14 w-10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="skeleton h-4 w-1/3" />
                    <div className="skeleton h-3 w-1/4" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : books.length === 0 ? (
          <div className="empty-state">
            <span className="icon-tile icon-tile-lg icon-tile-dark">
              <BookOpen size={24} />
            </span>
            <div className="space-y-1">
              <p className="empty-state-title">No books yet</p>
              <p className="empty-state-body">
                Paste an Amazon product link to capture a book&apos;s listing. Every campaign you build later
                comes from that one capture.
              </p>
            </div>
            <button onClick={onAddBook} className="btn btn-primary">
              <Plus size={20} />
              Add book
            </button>
          </div>
        ) : (
          <>
            <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                Showing {filteredBooks.length} of {books.length}
              </p>
              <div className="relative w-full sm:w-80">
                <Search size={20} className="input-icon" aria-hidden="true" />
                <label className="sr-only" htmlFor="book-search">
                  Search books
                </label>
                <input
                  id="book-search"
                  type="search"
                  placeholder="Search title, author or ASIN"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input input-with-icon"
                />
              </div>
            </div>

            {filteredBooks.length === 0 ? (
              <div className="empty-state">
                <span className="icon-tile icon-tile-lg">
                  <Search size={24} style={{ color: "var(--icon-default)" }} />
                </span>
                <div className="space-y-1">
                  <p className="empty-state-title">No matches</p>
                  <p className="empty-state-body">
                    No book matches “{searchTerm}”. Try the author, or the ASIN from the product URL.
                  </p>
                </div>
                <button onClick={() => setSearchTerm("")} className="btn btn-secondary">
                  Clear search
                </button>
              </div>
            ) : (
              <div className="table-wrap overflow-x-auto">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Book</th>
                      <th scope="col" className="hidden md:table-cell">
                        Marketplace
                      </th>
                      <th scope="col" className="hidden lg:table-cell">
                        Genre vocabulary
                      </th>
                      <th scope="col">Campaigns</th>
                      <th scope="col">
                        <span className="sr-only">Status</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredBooks.map((book) => {
                      const snapshot = book.metadata_json ?? {};
                      const captureFailed = snapshot.capture
                        ? !snapshot.capture.ok || snapshot.capture.blocked
                        : false;
                      return (
                        <tr
                          key={book.id}
                          onClick={() => onSelectBook(book.id)}
                          className="cursor-pointer"
                          tabIndex={0}
                          role="button"
                          aria-label={`Open ${book.title}`}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectBook(book.id);
                            }
                          }}
                        >
                          <td>
                            <div className="flex items-center gap-3">
                              {snapshot.coverImageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element -- Amazon CDN host isn't in next.config images.remotePatterns
                                <img
                                  src={snapshot.coverImageUrl}
                                  alt=""
                                  className="h-14 w-10 shrink-0 rounded object-contain"
                                  style={{ boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)" }}
                                />
                              ) : (
                                <span className="icon-tile" style={{ height: 56, width: 40 }}>
                                  <BookOpen size={20} style={{ color: "var(--icon-default)" }} />
                                </span>
                              )}
                              <div className="min-w-0">
                                <p className="cell-primary truncate">{book.title}</p>
                                <p className="meta-line truncate">
                                  {book.author} · <span className="font-mono">{book.asin}</span>
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="hidden md:table-cell">
                            <span className="badge badge-gray">{book.marketplace}</span>
                          </td>
                          <td className="hidden lg:table-cell">
                            {snapshot.genreTerms && snapshot.genreTerms.length > 0 ? (
                              <span className="line-clamp-2 max-w-xs">
                                {snapshot.genreTerms.slice(0, 4).join(" · ")}
                              </span>
                            ) : (
                              <span style={{ color: "var(--text-placeholder)" }}>—</span>
                            )}
                          </td>
                          <td>
                            {book.campaign_count > 0 ? (
                              <span className="cell-primary">{book.campaign_count}</span>
                            ) : (
                              <span style={{ color: "var(--text-placeholder)" }}>None yet</span>
                            )}
                          </td>
                          <td>
                            {captureFailed && (
                              <span className="badge badge-error" title="Metadata incomplete — open the book to re-fetch">
                                <AlertTriangle size={16} />
                                Metadata
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
