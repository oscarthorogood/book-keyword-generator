"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Loader2 } from "lucide-react";
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

/** Fallback wording for a response that carried no error message of its own. */
function describeHttpFailure(status: number): string {
  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 504 || status === 408) {
    return "Amazon took too long to respond, so the capture was cut short before the book could be saved. Try again — it usually works on a second attempt.";
  }
  if (status >= 500) return "The server hit an error while capturing this book. Try again in a moment.";
  return "Could not add that book.";
}

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
        // A gateway timeout has no JSON body, so `data.error` is empty and the
        // generic message told the user nothing about what to do next.
        throw new Error(data.error || describeHttpFailure(res.status));
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
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header">
        <button onClick={onBack} className="btn-link mb-4">
          <ArrowLeft size={20} />
          Back to books
        </button>
        <h1 className="page-title">Add a book</h1>
        <p className="page-subtitle mt-1 max-w-2xl">
          Paste the Amazon link and we capture the book&apos;s full metadata once, now. Every campaign you
          create later is built from that capture.
        </p>
      </header>

      <div className="page-body flex-1">
        <form onSubmit={handleSubmit} className="max-w-2xl">
          <div className="card mb-6">
            <p className="card-title mb-5">Book lookup</p>

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
              className={`input ${error ? "input-error" : ""}`}
              aria-describedby="book-input-hint"
              aria-invalid={error ? true : undefined}
            />
            <span className="field-hint" id="book-input-hint">
              A pasted product link is the most reliable — it carries both the ASIN and the marketplace. A
              bare ASIN or ISBN works too.
            </span>

            {parsed && (
              <p className="mt-3 flex flex-wrap items-center gap-2">
                <span className="badge badge-gray">
                  ASIN <span className="font-mono">{parsed.asin}</span>
                </span>
                {detectedMarketplace && <span className="badge badge-gray">{detectedMarketplace} marketplace</span>}
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
                <span className="field-hint">
                  Scraping a .co.uk listing against amazon.com returns a different book, so this has to match
                  where you advertise.
                </span>
              </div>
            )}
          </div>

          {error && (
            <div className="alert alert-error mb-6" role="alert">
              <AlertCircle size={20} className="mt-0.5 shrink-0" />
              <div>
                <p className="alert-title">Couldn&apos;t add that book</p>
                <p className="mt-1">{error}</p>
              </div>
            </div>
          )}

          {isSaving && (
            <div className="alert mb-6" aria-live="polite">
              <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin" style={{ color: "var(--icon-default)" }} />
              <div className="flex-1">
                <p className="alert-title">{CAPTURE_STEPS[stepIndex]}</p>
                <p className="mt-1">This takes up to a minute. It only happens once per book.</p>
                <div className="progress-track mt-3">
                  <div
                    className="progress-fill"
                    style={{ width: `${((stepIndex + 1) / CAPTURE_STEPS.length) * 100}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={onBack} className="btn btn-secondary" disabled={isSaving}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={isSaving || !input.trim()}>
              {isSaving && <Loader2 size={20} className="animate-spin" />}
              {isSaving ? "Adding book…" : "Add book"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
