"use client";

import { useState } from "react";

export interface AccessRequest {
  email: string;
  status: "pending" | "approved" | "denied";
  requested_at: string;
  decided_at: string | null;
}

const STATUS_TONE: Record<AccessRequest["status"], string> = {
  pending: "var(--accent-yellow)",
  approved: "var(--accent-green)",
  denied: "var(--muted)",
};

/**
 * The initial list is rendered on the server, so there is no fetch-on-mount
 * effect here — only refreshes after an action.
 */
export function AccessManager({
  adminEmail,
  initialRequests,
}: {
  adminEmail: string;
  initialRequests: AccessRequest[];
}) {
  const [requests, setRequests] = useState<AccessRequest[]>(initialRequests);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload() {
    try {
      const res = await fetch("/api/admin/access");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not reload requests.");
        return;
      }
      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reload requests.");
    }
  }

  async function decide(email: string, status: "approved" | "denied") {
    setBusy(email);
    setNotice(null);
    try {
      const res = await fetch("/api/admin/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, status }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not update access.");
        return;
      }
      setError(null);
      setNotice(
        status === "approved"
          ? data.emailed
            ? `${email} approved and emailed a sign-in link.`
            : `${email} approved, but the email failed to send — they can request a link themselves.`
          : `${email} revoked. Any active session has been ended.`
      );
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <div
          className="status-banner"
          style={{ background: "var(--accent-green-soft)", borderColor: "var(--accent-green)" }}
        >
          <span className="status-dot" style={{ background: "var(--accent-green)" }} />
          <span style={{ color: "var(--accent-green)" }}>{notice}</span>
        </div>
      )}
      {error && (
        <div
          className="status-banner"
          style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
        >
          <span className="status-dot" style={{ background: "var(--accent-red)" }} />
          <span style={{ color: "var(--accent-red)" }}>{error}</span>
        </div>
      )}

      {requests.length === 0 && (
        <p style={{ color: "var(--muted)" }}>No access requests yet.</p>
      )}

      {requests.map((r) => {
        const isSelf = r.email === adminEmail;
        return (
          <div
            key={r.email}
            className="source-row"
            style={{ alignItems: "center", flexWrap: "wrap", gap: "0.75rem" }}
          >
            <span className="flex items-center gap-2">
              <span
                className="status-dot"
                style={{ marginTop: 0, background: STATUS_TONE[r.status] }}
              />
              <span>
                {r.email}
                <span style={{ color: "var(--muted)" }}>
                  {" "}
                  · {r.status}
                  {isSelf ? " · you" : ""}
                </span>
              </span>
            </span>

            <span className="flex items-center gap-2">
              {r.status !== "approved" && (
                <button
                  type="button"
                  disabled={busy === r.email}
                  onClick={() => decide(r.email, "approved")}
                  className="btn-pill-dark text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  {r.status === "denied" ? "Reinstate" : "Approve"}
                </button>
              )}
              {r.status !== "denied" && !isSelf && (
                <button
                  type="button"
                  disabled={busy === r.email}
                  onClick={() => decide(r.email, "denied")}
                  className="btn-pill-outline text-xs px-3 py-1.5 disabled:opacity-50"
                >
                  {r.status === "approved" ? "Revoke" : "Deny"}
                </button>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
