"use client";

import { FormEvent, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AlertCircle, CheckCircle2, Clock, Loader2 } from "lucide-react";

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
    const sent = outcome.kind === "sent";
    return (
      <div className="space-y-5">
        <div className={`alert ${sent ? "alert-success" : "alert-warning"}`} aria-live="polite">
          {sent ? (
            <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          ) : (
            <Clock size={20} className="mt-0.5 shrink-0" />
          )}
          <div>
            <p className="alert-title">{sent ? "Check your inbox" : "Awaiting approval"}</p>
            <p className="mt-1">{outcome.message}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setOutcome(null);
            setEmail("");
          }}
          className="btn btn-secondary w-full"
        >
          Use a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
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
          className={`input ${error ? "input-error" : ""}`}
          disabled={isLoading}
          autoComplete="email"
          autoFocus
          required
          aria-invalid={error ? true : undefined}
        />
      </div>

      {error && (
        <div className="alert alert-error" role="alert">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <button type="submit" disabled={isLoading || !email} className="btn btn-primary w-full">
        {isLoading && <Loader2 size={20} className="animate-spin" />}
        {isLoading ? "Sending…" : "Email me a sign-in link"}
      </button>
    </form>
  );
}
