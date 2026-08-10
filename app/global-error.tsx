"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for errors thrown in the root layout itself. It
 * replaces the whole document, so it has to render its own <html>/<body> —
 * and it cannot rely on the app's stylesheet having loaded. The tokens it
 * needs are therefore inlined, and they are the same values as
 * app/globals.css.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled root error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "64px 16px",
          background: "#f9fafb",
          color: "#475467",
          fontFamily:
            'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          fontSize: "16px",
          lineHeight: "24px",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <div
          style={{
            background: "#ffffff",
            border: "1px solid #eaecf0",
            borderRadius: "12px",
            boxShadow: "0px 1px 2px rgba(16, 24, 40, 0.05)",
            padding: "48px 24px",
            textAlign: "center",
            maxWidth: "480px",
          }}
        >
          <h1
            style={{
              margin: "0 0 8px",
              fontSize: "18px",
              lineHeight: "28px",
              fontWeight: 600,
              color: "#101828",
            }}
          >
            Something went wrong
          </h1>
          <p style={{ margin: "0 0 24px", fontSize: "14px", lineHeight: "20px" }}>
            The app failed to start. Try again, and reload the page if the problem persists.
          </p>
          <button
            onClick={reset}
            style={{
              height: "40px",
              padding: "0 16px",
              borderRadius: "8px",
              border: "1px solid #101828",
              background: "#101828",
              color: "#ffffff",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
