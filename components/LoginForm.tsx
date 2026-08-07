"use client";

import { FormEvent, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const from = searchParams.get("from") || "/";

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "Login failed");
        setIsLoading(false);
        return;
      }

      // Redirect to the original page or home
      router.push(from);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="field-label">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter password"
          className="input"
          disabled={isLoading}
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
        disabled={isLoading || !password}
        className="btn-pill-dark w-full py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
