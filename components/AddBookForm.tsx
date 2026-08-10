"use client";

import { FormEvent, useState } from "react";
import { ArrowLeft } from "lucide-react";

const MARKETPLACES = ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const;

interface AddBookFormProps {
  onBack: () => void;
  onSuccess: () => void;
}

export default function AddBookForm({ onBack, onSuccess }: AddBookFormProps) {
  const [asin, setAsin] = useState("");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("US");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");

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
    <main className="flex-1 flex justify-center px-3 py-6 md:px-6 md:py-10">
      <div className="w-full max-w-2xl shell p-4 md:p-8">
        {/* Topbar */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to books"
            >
              <ArrowLeft size={20} className="text-gray-600" />
            </button>
            <div className="logo-mark">PB</div>
            <div>
              <p className="brand-title text-base md:text-lg">Add Book</p>
              <p className="eyebrow">Enter ASIN to add a new book</p>
            </div>
          </div>
        </div>

        {/* Page heading */}
        <div className="mb-6 md:mb-8">
          <h1 className="page-heading text-2xl md:text-4xl">Add a Book</h1>
          <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: "var(--muted)" }}>
            Enter an ASIN or ISBN to add a book to your library. We'll fetch the metadata automatically.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="space-y-6">
            {/* ASIN/ISBN Field */}
            <div className="card">
              <p className="card-title mb-4">Book Lookup</p>
              <div className="space-y-4">
                <div>
                  <label className="field-label">ASIN or ISBN</label>
                  <input
                    required
                    value={asin}
                    onChange={(e) => setAsin(e.target.value)}
                    placeholder="B0XXXXXXXX or 978XXXXXXXXXX"
                    maxLength={17}
                    className="input"
                  />
                  <span className="field-hint">
                    Enter an Amazon ASIN (10 chars) or ISBN (13 digits)
                  </span>
                </div>

                {/* Marketplace Selection */}
                <div>
                  <label className="field-label">Marketplace</label>
                  <select
                    value={marketplace}
                    onChange={(e) =>
                      setMarketplace(e.target.value as typeof marketplace)
                    }
                    className="input"
                  >
                    {MARKETPLACES.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <span className="field-hint">
                    Select the Amazon marketplace for this book
                  </span>
                </div>
              </div>
            </div>

            {/* Help Text */}
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-gray-900 mb-2">📖 Where to find ASIN</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                On Amazon product pages, the ASIN is listed in the "Product information" section.
                It's a 10-character code starting with "B0". ISBNs work too—we'll convert them automatically.
              </p>
            </div>
          </div>

          {/* Error Message */}
          {status === "error" && error && (
            <div
              className="mt-6 status-banner"
              style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
            >
              <span className="status-dot" style={{ background: "var(--accent-red)" }} />
              <span style={{ color: "var(--accent-red)" }}>{error}</span>
            </div>
          )}

          {/* Success Message */}
          {status === "success" && (
            <div
              className="mt-6 status-banner"
              style={{ background: "var(--accent-green-soft)", borderColor: "var(--accent-green)" }}
            >
              <span className="status-dot" style={{ background: "var(--accent-green)" }} />
              <span style={{ color: "var(--accent-green)" }}>Book added successfully! Redirecting...</span>
            </div>
          )}

          {/* Navigation */}
          <div className="flex gap-3 mt-8 justify-between">
            <button
              type="button"
              onClick={onBack}
              className="btn-pill-outline px-6 py-2.5"
            >
              ← Cancel
            </button>

            <button
              type="submit"
              disabled={isLoading || !asin}
              className="btn-pill-dark px-6 py-2.5"
            >
              {isLoading ? "Adding…" : "Add Book"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
