"use client";

import { useEffect, useState } from "react";
import { Plus, BookOpen, MoreVertical, Search } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  campaign_count: number;
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
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    async function loadBooks() {
      try {
        setLoading(true);
        const supabase = createBrowserClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );

        const { data, error: err } = await supabase
          .from("books")
          .select("*")
          .order("created_at", { ascending: false });

        if (err) {
          console.warn("Could not load books:", err.message);
          setBooks([]);
        } else {
          setBooks(data || []);
        }
      } catch (err) {
        console.warn("Failed to load books:", err);
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
        {/* Quick Action Cards */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          <button
            onClick={onAddBook}
            className="group bg-gray-900 rounded-xl p-8 text-white hover:bg-gray-800 transition-all flex flex-col items-center justify-center gap-3 min-h-28"
          >
            <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <Plus size={24} />
            </div>
            <span className="text-base font-semibold">Add Book</span>
          </button>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 flex flex-col items-center justify-center gap-3 opacity-50 cursor-not-allowed min-h-28">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
              <BookOpen size={24} className="text-gray-400" />
            </div>
            <span className="text-base font-semibold text-gray-900">Series</span>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-8 flex flex-col items-center justify-center gap-3 opacity-50 cursor-not-allowed min-h-28">
            <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
              <BookOpen size={24} className="text-gray-400" />
            </div>
            <span className="text-base font-semibold text-gray-900">Collections</span>
          </div>
        </div>

        {/* Book List */}
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4">Your Books</h2>
        </div>

        {isEmpty ? (
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
              <div className="space-y-2">
                {filteredBooks.map((book) => (
                  <button
                    key={book.id}
                    onClick={() => onSelectBook(book)}
                    className="w-full flex items-center justify-between p-4 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors group text-left"
                  >
                    <div className="flex items-center gap-4 flex-1">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                        <BookOpen size={20} className="text-gray-600" />
                      </div>
                      <div className="flex-1">
                        <p className="font-medium text-gray-900">{book.title}</p>
                        <p className="text-xs text-gray-500">by {book.author} · {book.asin}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-6 text-sm">
                      <div className="text-center">
                        <p className="text-gray-900 font-medium">{book.campaign_count}</p>
                        <p className="text-xs text-gray-500">campaigns</p>
                      </div>
                      <div className="text-center">
                        <p className="text-gray-900 font-medium">{book.total_keywords}</p>
                        <p className="text-xs text-gray-500">keywords</p>
                      </div>
                      <div className="text-center w-24">
                        <p className="text-gray-500 text-xs">
                          {new Date(book.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                          })}
                        </p>
                      </div>
                      <button className="text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-all p-2">
                        <MoreVertical size={18} />
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
