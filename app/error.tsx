"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * Route-level error boundary. Without it, an unhandled render error drops the
 * user onto Next's default error screen, which is outside the design system
 * and offers nothing to do next.
 *
 * The error message itself is not shown: it can carry internal detail (a
 * database error, a stack frame), and it is logged for the console instead.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled error:", error);
  }, [error]);

  return (
    <main
      className="flex min-h-screen flex-1 items-center justify-center px-4 py-16"
      style={{ background: "var(--bg-subtle)" }}
    >
      <div className="empty-state max-w-lg">
        <span className="icon-tile icon-tile-lg" style={{ background: "var(--color-error-100)" }}>
          <AlertTriangle size={24} style={{ color: "var(--color-error-600)" }} />
        </span>
        <div className="space-y-2">
          <p className="empty-state-title">Something went wrong</p>
          <p className="empty-state-body">
            This page failed to load. Trying again usually works; if it doesn&apos;t, reload the app.
          </p>
          {error.digest && (
            <p className="text-xs font-mono" style={{ color: "var(--text-tertiary)" }}>
              Reference: {error.digest}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button onClick={reset} className="btn btn-primary">
            <RotateCw size={20} />
            Try again
          </button>
          <Link href="/" className="btn btn-secondary no-underline">
            Back to books
          </Link>
        </div>
      </div>
    </main>
  );
}
