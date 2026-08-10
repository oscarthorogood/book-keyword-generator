"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, BookOpen, Search, AlertTriangle } from "lucide-react";

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  total_keywords: number;
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

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-mid)" }}>
      <header className="border-b px-8 py-6 flex items-center justify-between gap-4">
        <div>
          <p className="eyebrow mb-1">Library</p>
          <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
            Books
          </h1>
        </div>
        <button onClick={onAddBook} className="btn-pill-dark">
          <Plus size={16} />
          Add book
        </button>
      </header>

      <div className="flex-1 px-8 py-8">
        {loadError ? (
          <div
            className="status-banner"
            style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
          >
            <AlertTriangle size={16} className="mt-0.5" style={{ color: "var(--accent-red)" }} />
            <div>
              <p className="font-medium" style={{ color: "var(--ink)" }}>
                Couldn&apos;t load your books
              </p>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                {loadError}
              </p>
            </div>
          </div>
        ) : loading ? (
          <p className="text-center py-16 text-sm" style={{ color: "var(--muted)" }}>
            Loading books…
          </p>
        ) : books.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border" style={{ background: "var(--panel-muted)" }}>
            <BookOpen size={40} className="mx-auto mb-4" style={{ color: "var(--muted)" }} />
            <p className="text-sm mb-4" style={{ color: "var(--muted)" }}>
              No books yet. Paste an Amazon link to add your first one.
            </p>
            <button onClick={onAddBook} className="btn-pill-dark">
              <Plus size={16} />
              Add book
            </button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 mb-6">
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                {filteredBooks.length} book{filteredBooks.length === 1 ? "" : "s"}
              </p>
              <div className="relative w-72">
                <Search size={16} className="absolute left-3 top-2.5" style={{ color: "var(--muted)" }} />
                <input
                  type="text"
                  placeholder="Search title, author or ASIN…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="input pl-9"
                />
              </div>
            </div>

            {filteredBooks.length === 0 ? (
              <div className="text-center py-16 rounded-2xl border" style={{ background: "var(--panel-muted)" }}>
                <p className="text-sm" style={{ color: "var(--muted)" }}>
                  No books match that search.
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredBooks.map((book) => {
                  const snapshot = book.metadata_json ?? {};
                  const captureFailed = snapshot.capture ? !snapshot.capture.ok || snapshot.capture.blocked : false;
                  return (
                    <button
                      key={book.id}
                      onClick={() => onSelectBook(book.id)}
                      className="card flex items-center gap-4 text-left w-full hover:opacity-90 transition-opacity"
                      style={{ padding: "1rem 1.25rem" }}
                    >
                      {snapshot.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- Amazon CDN host isn't in next.config images.remotePatterns
                        <img
                          src={snapshot.coverImageUrl}
                          alt=""
                          className="w-10 h-14 object-contain rounded flex-shrink-0"
                        />
                      ) : (
                        <div
                          className="w-10 h-14 rounded flex items-center justify-center flex-shrink-0"
                          style={{ background: "var(--panel-muted)" }}
                        >
                          <BookOpen size={16} style={{ color: "var(--muted)" }} />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate" style={{ color: "var(--ink)" }}>
                          {book.title}
                        </p>
                        <p className="text-xs truncate" style={{ color: "var(--muted)" }}>
                          {book.author} · {book.marketplace} · <span className="font-mono">{book.asin}</span>
                        </p>
                        {snapshot.genreTerms && snapshot.genreTerms.length > 0 && (
                          <p className="text-xs mt-1 truncate" style={{ color: "var(--muted)" }}>
                            {snapshot.genreTerms.slice(0, 4).join(" · ")}
                          </p>
                        )}
                      </div>

                      {captureFailed && (
                        <span
                          className="text-xs inline-flex items-center gap-1"
                          style={{ color: "var(--accent-red)" }}
                          title="Metadata incomplete — open the book to re-fetch"
                        >
                          <AlertTriangle size={13} />
                          Metadata
                        </span>
                      )}

                      <div className="text-right flex-shrink-0">
                        <p className="text-lg font-bold" style={{ color: "var(--ink)" }}>
                          {book.total_keywords}
                        </p>
                        <p className="text-xs" style={{ color: "var(--muted)" }}>
                          keywords
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
