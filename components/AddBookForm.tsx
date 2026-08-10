"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft } from "lucide-react";

const MARKETPLACES = ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const;

interface AddBookFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

interface BookMetadata {
  asin?: string;
  title?: string;
  author?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  publisher?: string;
  publicationDate?: string;
}

export default function AddBookForm({ onBack, onSuccess }: AddBookFormProps) {
  const [asin, setAsin] = useState("");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("US");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

  const [autofillStatus, setAutofillStatus] = useState<"idle" | "loading" | "error">("idle");
  const [autofillError, setAutofillError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<BookMetadata | null>(null);
  const [bookTitle, setBookTitle] = useState("");
  const [bookAuthor, setBookAuthor] = useState("");

  async function handleAutofill() {
    if (!asin.trim()) {
      setAutofillError("Please enter an ASIN or ISBN");
      setAutofillStatus("error");
      return;
    }

    setAutofillStatus("loading");
    setAutofillError(null);

    try {
      const res = await fetch(
        `/api/lookup?asin=${encodeURIComponent(asin)}&marketplace=${marketplace}`
      );
      const body = await res.json();

      if (!res.ok) {
        setAutofillError(body.error ?? "Failed to lookup book");
        setAutofillStatus("error");
        return;
      }

      setMetadata(body);
      setBookTitle(body.title || "");
      setBookAuthor(body.author || "");
      setAutofillStatus("idle");
    } catch (err) {
      setAutofillError(err instanceof Error ? err.message : "Something went wrong");
      setAutofillStatus("error");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    setStatus("loading");

    try {
      if (!asin || !marketplace) {
        throw new Error("Please fill in all fields");
      }

      const res = await fetch("/api/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin,
          marketplace,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create book");
      }

      setStatus("success");
      // Redirect after success
      setTimeout(() => {
        onSuccess();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
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
        <h1 className="text-2xl font-bold text-gray-900">Add a Book</h1>
        <p className="text-sm text-gray-500 mt-1">
          Enter an ASIN or ISBN to add a book to your library. We&apos;ll fetch the metadata automatically.
        </p>
      </div>

      {/* Main Content */}
      <div className="flex-1 px-8 py-8">
        <form onSubmit={handleSubmit} className="max-w-xl">
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 mb-6">
            <p className="text-xs text-gray-600 font-medium mb-4">BOOK LOOKUP</p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">
                  ASIN or ISBN
                </label>
                <div className="flex gap-2">
                  <input
                    required
                    value={asin}
                    onChange={(e) => setAsin(e.target.value)}
                    placeholder="B0XXXXXXXX or 978XXXXXXXXXX"
                    maxLength={17}
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 bg-white text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleAutofill}
                    disabled={autofillStatus === "loading" || !asin.trim()}
                    className="px-4 py-2.5 bg-gray-900 text-white rounded-lg font-medium text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
                  >
                    {autofillStatus === "loading" ? "Looking up…" : "Autofill"}
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-1.5">
                  Enter an Amazon ASIN (10 chars) or ISBN, then click Autofill to fetch book details
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-900 mb-1.5">
                  Marketplace
                </label>
                <select
                  value={marketplace}
                  onChange={(e) => setMarketplace(e.target.value as typeof marketplace)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 bg-white text-sm"
                >
                  {MARKETPLACES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1.5">
                  Select the Amazon marketplace for this book
                </p>
              </div>

              {autofillStatus === "error" && autofillError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  {autofillError}
                </div>
              )}
            </div>
          </div>

          {metadata && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
              <p className="text-xs text-blue-600 font-medium mb-4">FETCHED METADATA</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1.5">
                    Title
                  </label>
                  <input
                    type="text"
                    value={bookTitle}
                    onChange={(e) => setBookTitle(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 bg-white text-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-900 mb-1.5">
                    Author
                  </label>
                  <input
                    type="text"
                    value={bookAuthor}
                    onChange={(e) => setBookAuthor(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-gray-400 bg-white text-sm"
                  />
                </div>

                {metadata.price && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1.5">
                      Price
                    </label>
                    <p className="text-sm text-gray-600">${metadata.price.toFixed(2)}</p>
                  </div>
                )}

                {metadata.publisher && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1.5">
                      Publisher
                    </label>
                    <p className="text-sm text-gray-600">{metadata.publisher}</p>
                  </div>
                )}

                {metadata.publicationDate && (
                  <div>
                    <label className="block text-sm font-medium text-gray-900 mb-1.5">
                      Publication Date
                    </label>
                    <p className="text-sm text-gray-600">{metadata.publicationDate}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
            <p className="text-sm font-semibold text-gray-900 mb-2">📖 Where to find ASIN</p>
            <p className="text-xs text-gray-600 leading-relaxed">
              On Amazon product pages, the ASIN is listed in the &quot;Product information&quot; section.
              It&apos;s a 10-character code starting with &quot;B0&quot;. ISBNs work too—we&apos;ll convert them automatically.
            </p>
          </div>

          {status === "error" && error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {status === "success" && (
            <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              Book added successfully! Redirecting...
            </div>
          )}

          <div className="flex gap-3 justify-between">
            <button
              type="button"
              onClick={onBack}
              className="px-6 py-2.5 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isLoading || !asin}
              className="bg-gray-900 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-2.5 rounded-lg text-sm font-medium text-white transition-colors"
            >
              {isLoading ? "Adding…" : "Add Book"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
