"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";

interface SharedKeyword {
  text: string;
  otherBooks: Array<{ bookId: string; bookTitle: string }>;
  suggestedOwnerBookId: string | null;
}

/**
 * Per-book cannibalization callout (Enhancements spec §14): which of this
 * book's active keywords are also active on another of the user's books,
 * with a one-click "keep here, pause elsewhere" action. Own fetch, fails
 * soft — a broken check here shouldn't block the keyword manager below it.
 */
export default function CannibalizationPanel({ bookId, onResolved }: { bookId: string; onResolved?: () => void }) {
  const [shared, setShared] = useState<SharedKeyword[] | null>(null);
  const [resolvingText, setResolvingText] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let active = true;
    setDismissed(false);
    fetch(`/api/books/${bookId}/keywords/cannibalization`)
      .then((res) => res.json().catch(() => ({})))
      .then((body) => {
        if (active && Array.isArray(body.shared)) setShared(body.shared);
      })
      .catch(() => {
        /* fail soft — no panel rather than an error banner over the manager */
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  async function pauseElsewhere(text: string) {
    setResolvingText(text);
    try {
      await fetch(`/api/books/${bookId}/keywords/cannibalization`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setShared((prev) => (prev ? prev.filter((s) => s.text !== text) : prev));
      onResolved?.();
    } finally {
      setResolvingText(null);
    }
  }

  if (!shared || shared.length === 0 || dismissed) return null;

  return (
    <div className="alert alert-error mb-6" role="alert">
      <AlertTriangle size={20} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="alert-title">
            {shared.length} keyword{shared.length === 1 ? " is" : "s are"} also active on another book
          </p>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Hide this warning"
            className="btn btn-tertiary btn-sm shrink-0 p-1"
          >
            <X size={16} />
          </button>
        </div>
        <p className="mt-1 mb-2">
          Same keyword, active on two books, competes against itself in Amazon&apos;s auction.
        </p>
        <ul className="space-y-2">
          {shared.map((item) => (
            <li key={item.text} className="flex flex-wrap items-center gap-2">
              <span className="cell-primary">{item.text}</span>
              <span className="meta-line text-xs">
                also on{" "}
                {item.otherBooks.map((b, i) => (
                  <span key={b.bookId}>
                    {i > 0 && ", "}
                    <Link href={`/books/${b.bookId}`} className="underline">
                      {b.bookTitle}
                    </Link>
                  </span>
                ))}
                {item.suggestedOwnerBookId && item.suggestedOwnerBookId !== bookId && " · suggested owner: elsewhere"}
                {item.suggestedOwnerBookId === bookId && " · suggested owner: this book"}
              </span>
              <button
                onClick={() => pauseElsewhere(item.text)}
                disabled={resolvingText === item.text}
                className="btn btn-tertiary btn-sm"
              >
                {resolvingText === item.text ? "Pausing…" : "Keep here, pause elsewhere"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
