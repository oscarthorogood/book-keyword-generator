"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { parseAmazonInput } from "@/lib/amazonUrl";

const MARKETPLACES = ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const;

// The create call reads the product page, crawls comparable titles and
// queries the external catalogues, so it takes a while. Naming the step in
// progress is the difference between "working" and "frozen".
const CAPTURE_STEPS = [
  "Reading the Amazon product page…",
  "Pulling categories, series and format details…",
  "Crawling comparable titles and also-boughts…",
  "Collecting reviews, Q&A and author catalogue…",
  "Matching Google Books, Open Library and Goodreads…",
  "Almost there — saving the book…",
];

interface AddBookFormProps {
  onBack: () => void;
  onSuccess: (bookId: string) => void;
}

export default function AddBookForm({ onBack, onSuccess }: AddBookFormProps) {
  const [input, setInput] = useState("");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("US");
  const [isSaving, setIsSaving] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Same parser the API uses, so the form can show what it read out of a
  // pasted link before the request is sent.
  const parsed = useMemo(() => parseAmazonInput(input), [input]);
  const detectedMarketplace = parsed?.marketplace;

  useEffect(() => {
    if (!isSaving) return;
    const timer = setInterval(() => {
      setStepIndex((current) => Math.min(current + 1, CAPTURE_STEPS.length - 1));
    }, 6000);
    return () => clearInterval(timer);
  }, [isSaving]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || isSaving) return;

    setIsSaving(true);
    setStepIndex(0);
    setError(null);

    try {
      const res = await fetch("/api/books/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ input: input.trim(), marketplace }),
      });
      const data = await res.json().catch(() => ({}));

      // 409 means the book is already in the library — the point of typing an
      // ASIN is to land on that book either way, so treat it as success.
      const bookId = data.book?.id ?? data.bookId;
      if (!res.ok && res.status !== 409) {
        throw new Error(data.error || "Could not add that book.");
      }
      if (!bookId) {
        throw new Error("The book was saved but no ID came back. Refresh your library to find it.");
      }

      onSuccess(bookId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-mid)" }}>
      <header className="border-b px-8 py-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm mb-4"
          style={{ color: "var(--muted)" }}
        >
          <ArrowLeft size={18} />
          Back to books
        </button>
        <p className="eyebrow mb-1">Add a book</p>
        <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
          Paste the Amazon link
        </h1>
        <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
          That&apos;s all we need. We capture the book&apos;s full Amazon metadata once, now, and every
          keyword you generate later is built from it.
        </p>
      </header>

      <div className="flex-1 px-8 py-8">
        <form onSubmit={handleSubmit} className="max-w-xl">
          <div className="card mb-6">
            <p className="card-title mb-4">Book lookup</p>

            <label className="field-label" htmlFor="book-input">
              Amazon link, ASIN or ISBN
            </label>
            <input
              id="book-input"
              required
              autoFocus
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://www.amazon.com/dp/B0XXXXXXXX"
              disabled={isSaving}
              className="input"
            />
            <span className="field-hint">
              A pasted product link is the most reliable — it tells us the ASIN and the marketplace. A bare
              ASIN or ISBN works too.
            </span>

            {parsed && (
              <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
                Detected ASIN <span className="font-mono">{parsed.asin}</span>
                {detectedMarketplace ? ` · ${detectedMarketplace} marketplace` : ""}
              </p>
            )}

            {/* Only meaningful when the input can't say which store it came
                from — a link already carries its marketplace. */}
            {!detectedMarketplace && (
              <div className="mt-5">
                <label className="field-label" htmlFor="marketplace">
                  Marketplace
                </label>
                <select
                  id="marketplace"
                  value={marketplace}
                  onChange={(e) => setMarketplace(e.target.value as typeof marketplace)}
                  disabled={isSaving}
                  className="input"
                >
                  {MARKETPLACES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {error && (
            <div
              className="status-banner mb-6"
              style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
            >
              <span className="status-dot" style={{ background: "var(--accent-red)" }} />
              <span>{error}</span>
            </div>
          )}

          {isSaving && (
            <div className="status-banner mb-6" style={{ background: "var(--panel-muted)" }}>
              <Loader2 size={16} className="animate-spin mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-medium" style={{ color: "var(--ink)" }}>
                  {CAPTURE_STEPS[stepIndex]}
                </p>
                <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  This takes up to a minute. It only happens once per book.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={onBack} className="btn-pill-outline" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn-pill-dark" disabled={isSaving || !input.trim()}>
              {isSaving ? "Adding book…" : "Add book"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
