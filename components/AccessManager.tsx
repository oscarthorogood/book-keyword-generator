"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

export interface AccessRequest {
  email: string;
  status: "pending" | "approved" | "denied";
  requested_at: string;
  sign_in_count: number;
  last_signed_in_at: string | null;
}

const STATUS_BADGE: Record<AccessRequest["status"], string> = {
  pending: "badge-warning",
  approved: "badge-success",
  denied: "badge-gray",
};

const STATUS_LABEL: Record<AccessRequest["status"], string> = {
  pending: "Active",
  approved: "Active",
  denied: "Blocked",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

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
        setError(data.error ?? "Could not reload users.");
        return;
      }
      setRequests(data.requests ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reload users.");
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
            ? `${email} unblocked and emailed a sign-in link.`
            : `${email} unblocked, but the email failed to send — they can request a link themselves.`
          : `${email} blocked. Any active session has been ended.`
      );
      await reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      {notice && (
        <div className="alert alert-success" aria-live="polite">
          <CheckCircle2 size={20} className="mt-0.5 shrink-0" />
          <p>{notice}</p>
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          <AlertCircle size={20} className="mt-0.5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="empty-state">
          <div className="space-y-1">
            <p className="empty-state-title">No users yet</p>
            <p className="empty-state-body">
              Once someone signs in, they&apos;ll appear here.
            </p>
          </div>
        </div>
      ) : (
        <div className="table-wrap overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Email</th>
                <th scope="col">Status</th>
                <th scope="col" className="hidden sm:table-cell">
                  Sign-ins
                </th>
                <th scope="col" className="hidden sm:table-cell">
                  Last seen
                </th>
                <th scope="col" className="hidden sm:table-cell">
                  First seen
                </th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => {
                const isSelf = r.email === adminEmail;
                const blocked = r.status === "denied";
                return (
                  <tr key={r.email}>
                    <td>
                      <div className="flex items-center gap-3">
                        <span className="avatar avatar-sm" aria-hidden="true">
                          {r.email.slice(0, 2).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="cell-primary truncate">{r.email}</p>
                          {isSelf && <p className="meta-line text-xs">This is you</p>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[r.status]}`}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="hidden sm:table-cell">{r.sign_in_count}</td>
                    <td className="hidden sm:table-cell">{formatDate(r.last_signed_in_at)}</td>
                    <td className="hidden sm:table-cell">{formatDate(r.requested_at)}</td>
                    <td>
                      <div className="flex items-center justify-end gap-2">
                        {blocked && (
                          <button
                            type="button"
                            disabled={busy === r.email}
                            onClick={() => decide(r.email, "approved")}
                            className="btn btn-primary btn-sm"
                          >
                            {busy === r.email && <Loader2 size={16} className="animate-spin" />}
                            Unblock
                          </button>
                        )}
                        {!blocked && !isSelf && (
                          <button
                            type="button"
                            disabled={busy === r.email}
                            onClick={() => decide(r.email, "denied")}
                            className="btn btn-secondary btn-sm"
                          >
                            {busy === r.email && <Loader2 size={16} className="animate-spin" />}
                            Block
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
