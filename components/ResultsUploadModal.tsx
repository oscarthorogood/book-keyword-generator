"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";

interface ResultsUploadModalProps {
  bookId: string;
  onClose: () => void;
  /** Fired after a successful import — lets the caller refresh keyword/campaign data. */
  onImported?: () => void;
}

/**
 * Uploads an Amazon Search Term Report CSV to
 * POST /api/books/[id]/results/import (campaigns spec §5). The route
 * itself has existed since PR 8b with no UI — this is that UI.
 */
export default function ResultsUploadModal({ bookId, onClose, onImported }: ResultsUploadModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [reportStart, setReportStart] = useState("");
  const [reportEnd, setReportEnd] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ matched_count: number; unmatched_count: number; row_count: number } | null>(null);

  async function submit() {
    if (!file || !reportStart || !reportEnd) {
      setError("A file and both report dates are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("reportStart", reportStart);
      formData.append("reportEnd", reportEnd);

      const res = await fetch(`/api/books/${bookId}/results/import`, { method: "POST", body: formData });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to import results");
        return;
      }
      setResult(body.import);
      onImported?.();
    } catch {
      setError("Failed to import results");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        style={{
          background: "var(--bg-surface, #fff)",
          borderRadius: 12,
          padding: 24,
          width: "min(480px, 92vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Upload campaign results</h2>
          <button className="btn btn-tertiary btn-icon btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <p className="text-sm mb-3" style={{ color: "var(--text-secondary)" }}>
          Upload an Amazon Search Term Report CSV. It&rsquo;s matched to your keywords/ASINs and rolled up onto them
          for Update Campaign to use.
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="text-sm font-medium">Search Term Report (CSV)</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="input mt-1 w-full"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Report start</span>
              <input type="date" className="input mt-1 w-full" value={reportStart} onChange={(e) => setReportStart(e.target.value)} />
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Report end</span>
              <input type="date" className="input mt-1 w-full" value={reportEnd} onChange={(e) => setReportEnd(e.target.value)} />
            </label>
          </div>
        </div>

        {error && (
          <div className="alert alert-error mt-3" role="alert">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1">{error}</p>
          </div>
        )}

        {result && (
          <div className="alert alert-success mt-3" aria-live="polite">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0" />
            <p className="flex-1">
              Imported {result.row_count} row(s) — {result.matched_count} matched, {result.unmatched_count} unmatched.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn btn-tertiary" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button className="btn btn-primary" onClick={submit} disabled={submitting}>
              {submitting ? <Loader2 size={16} className="animate-spin" /> : null} Upload
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
