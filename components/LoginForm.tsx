"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";

type Outcome = { kind: "sent" | "pending"; message: string };

const LINK_ERRORS: Record<string, string> = {
  invalid_link: "That sign-in link was incomplete. Request a fresh one below.",
  expired_link: "That sign-in link has expired or was already used. Request a fresh one below.",
};

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [error, setError] = useState<string | null>(
    LINK_ERRORS[searchParams.get("error") ?? ""] ?? null
  );
  const [isLoading, setIsLoading] = useState(false);
  const from = searchParams.get("from") || "/";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOutcome(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, next: from }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error || "Could not send the link. Try again.");
        return;
      }

      setOutcome({
        kind: data.status === "pending" ? "pending" : "sent",
        message: data.message,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  }

  // Once a link is on its way there's nothing more to do here — showing the
  // form again just invites people to hammer the button.
  if (outcome) {
    const accent = outcome.kind === "sent" ? "var(--accent-green)" : "var(--accent-yellow)";
    const soft =
      outcome.kind === "sent" ? "var(--accent-green-soft)" : "var(--accent-yellow-soft)";
    return (
      <div className="space-y-4">
        <div className="status-banner" style={{ background: soft, borderColor: accent }}>
          <span className="status-dot" style={{ background: accent }} />
          <span style={{ color: accent }}>{outcome.message}</span>
        </div>
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            setEmail("");
          }}
          className="btn-pill-outline w-full py-2.5"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="field-label">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="input"
          disabled={isLoading}
          autoComplete="email"
          autoFocus
          required
        />
      </div>

      {error && (
        <div
          className="status-banner"
          style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
        >
          <span className="status-dot" style={{ background: "var(--accent-red)" }} />
          <span style={{ color: "var(--accent-red)" }}>{error}</span>
        </div>
      )}

      <button
        type="submit"
        disabled={isLoading || !email}
        className="btn-pill-dark w-full py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
