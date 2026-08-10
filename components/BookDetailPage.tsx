"use client";

import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import KeywordManager from "./KeywordManager";

interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  description?: string;
  total_keywords: number;
  created_at: string;
  metadata_json?: any;
}

interface BookDetailPageProps {
  bookId: string;
  onBack: () => void;
}

export default function BookDetailPage({
  bookId,
  onBack,
}: BookDetailPageProps) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadBook() {
      try {
        setLoading(true);
        const res = await fetch(`/api/books/${bookId}`);
        const body = await res.json().catch(() => ({}));

        if (!res.ok) {
          console.warn("Could not load book:", body.error);
          setBook(null);
        } else {
          setBook(body.book as Book);
        }
      } catch (err) {
        console.warn("Failed to load book:", err);
        setBook(null);
      } finally {
        setLoading(false);
      }
    }

    loadBook();
  }, [bookId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-gray-200 border-t-gray-700 rounded-full mx-auto mb-4"></div>
          <p className="text-gray-600">Loading book...</p>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen bg-white flex flex-col">
        <div className="bg-white border-b border-gray-200 px-8 py-6">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900"
          >
            <ArrowLeft size={20} />
            Back to Books
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-gray-600">Book not found</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-8 py-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4"
        >
          <ArrowLeft size={20} />
          Back to Books
        </button>
        <h1 className="text-2xl font-bold text-gray-900">{book.title}</h1>
        <p className="text-sm text-gray-500 mt-1">by {book.author}</p>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-8 py-8">
        {/* Book Info Cards */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">ASIN</p>
            <p className="text-lg font-bold text-gray-900 font-mono mt-2">{book.asin}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">Marketplace</p>
            <p className="text-lg font-bold text-gray-900 mt-2">{book.marketplace}</p>
          </div>
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-xs text-gray-600 font-medium">Total Keywords</p>
            <p className="text-lg font-bold text-gray-900 mt-2">{book.total_keywords}</p>
          </div>
        </div>

        {/* Keyword Manager */}
        <KeywordManager bookId={bookId} />
      </div>
    </div>
  );
}
