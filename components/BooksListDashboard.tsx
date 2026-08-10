"use client";

import { useEffect, useState } from "react";
import { Plus, BookOpen, Search } from "lucide-react";

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  total_keywords: number;
  created_at: string;
}

interface BooksListDashboardProps {
  onAddBook: () => void;
  onSelectBook: (book: Book) => void;
}

export default function BooksListDashboard({
  onAddBook,
  onSelectBook,
}: BooksListDashboardProps) {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    async function loadBooks() {
      try {
        setLoading(true);
        setLoadError(null);
        const res = await fetch("/api/books/list");
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          setLoadError(body.error || "Could not load books.");
          setBooks([]);
        } else {
          setBooks(body.books || []);
        }
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "Could not load books.");
        setBooks([]);
      } finally {
        setLoading(false);
      }
    }

    loadBooks();
  }, []);

  const filteredBooks = books.filter((book) => {
    const matchesSearch =
      book.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      book.author.toLowerCase().includes(searchTerm.toLowerCase()) ||
      book.asin.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesSearch;
  });

  const isEmpty = books.length === 0;

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <h1 className="text-2xl font-bold text-gray-900">Books</h1>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-8 py-8">
        {/* Add Book */}
        <div className="mb-8">
          <button
            onClick={onAddBook}
            className="group bg-gray-900 rounded-xl px-6 py-4 text-white hover:bg-gray-800 transition-all inline-flex items-center gap-3"
          >
            <div className="w-8 h-8 bg-white/10 rounded-lg flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <Plus size={18} />
            </div>
            <span className="text-sm font-semibold">Add Book</span>
          </button>
        </div>

        {/* Book List */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Your Books</h2>
        </div>

        {loadError ? (
          <div className="text-center py-16 bg-red-50 rounded-lg border border-red-200">
            <p className="text-red-700 font-medium">Couldn&apos;t load your books</p>
            <p className="text-red-600 text-sm mt-1">{loadError}</p>
          </div>
        ) : isEmpty && !loading ? (
          <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
            <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600">No books yet. Add one to get started.</p>
          </div>
        ) : (
          <>
            {/* Search and Filter */}
            <div className="flex items-center justify-between mb-6">
              <div className="text-sm text-gray-600">
                {filteredBooks.length} book{filteredBooks.length !== 1 ? "s" : ""}
              </div>
              <div className="relative w-64">
                <Search className="absolute right-3 top-2.5 text-gray-400" size={18} />
                <input
                  type="text"
                  placeholder="Search books..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full pr-10 pl-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 bg-white text-sm"
                />
              </div>
            </div>

            {/* Books List */}
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="text-center">
                  <div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-gray-700 rounded-full mx-auto mb-4"></div>
                  <p className="text-gray-600">Loading books...</p>
                </div>
              </div>
            ) : filteredBooks.length === 0 ? (
              <div className="text-center py-16 bg-gray-50 rounded-lg border border-gray-200">
                <BookOpen size={48} className="mx-auto text-gray-300 mb-4" />
                <p className="text-gray-600">No books found</p>
              </div>
            ) : (
              <div className="border border-gray-200 rounded-lg overflow-hidden overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-gray-600 text-xs uppercase">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium">Title</th>
                      <th className="text-left px-4 py-3 font-medium">Author</th>
                      <th className="text-left px-4 py-3 font-medium">ASIN</th>
                      <th className="text-left px-4 py-3 font-medium">Marketplace</th>
                      <th className="text-right px-4 py-3 font-medium">Keywords</th>
                      <th className="text-right px-4 py-3 font-medium">Added</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filteredBooks.map((book) => (
                      <tr
                        key={book.id}
                        onClick={() => onSelectBook(book)}
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                              <BookOpen size={16} className="text-gray-600" />
                            </div>
                            <span className="font-medium text-gray-900">{book.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{book.author}</td>
                        <td className="px-4 py-3 text-gray-500 font-mono text-xs">{book.asin}</td>
                        <td className="px-4 py-3 text-gray-600">{book.marketplace}</td>
                        <td className="px-4 py-3 text-right text-gray-900 font-medium">
                          {book.total_keywords}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-500 text-xs">
                          {new Date(book.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </td>
                      </tr>
                    ))}
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
