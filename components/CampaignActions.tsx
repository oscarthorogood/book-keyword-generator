"use client";

import { useState } from "react";
import { Loader2, Rocket } from "lucide-react";

interface CreatedCampaign {
  id: string;
  campaign_type: string;
  name: string;
  daily_budget: number;
  amazon_campaign_id: string | null;
}

/**
 * "Create campaign" action for the 5-campaign structure (campaigns spec
 * §4). Builds the plan server-side, and — since the spec's typed-confirmation
 * gate is a real budget commitment, not a cosmetic dialog — resubmits with
 * `confirmed: true` only after the user explicitly accepts the computed
 * total. UI copy stays "Create campaign" / "Download bulksheet", not
 * "Upload to Amazon" — this app has no live Ads API integration; the human
 * still uploads the generated file to Amazon Ads themselves.
 */
export default function CampaignActions({ bookId }: { bookId: string }) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ campaigns: CreatedCampaign[]; downloadUrl: string | null; totalDailyBudget: number } | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  async function createCampaign(confirmed = false) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/books/${bookId}/campaigns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed }),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 400 && body.needsConfirmation) {
        const breakdown = (body.plans ?? [])
          .map((p: { name: string; dailyBudget: number }) => `${p.name}: ${p.dailyBudget.toFixed(2)}/day`)
          .join("\n");
        const proceed = window.confirm(
          `This creates ${body.plans?.length ?? "several"} campaign(s) totalling ${Number(body.totalDailyBudget).toFixed(2)}/day:\n\n${breakdown}\n\nContinue?`
        );
        if (proceed) return createCampaign(true);
        return;
      }

      if (!res.ok) {
        setError(body.error ?? "Failed to create campaign");
        return;
      }

      setResult({ campaigns: body.campaigns ?? [], downloadUrl: body.downloadUrl ?? null, totalDailyBudget: body.totalDailyBudget });
    } catch {
      setError("Failed to create campaign");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mb-6">
      <button onClick={() => createCampaign(false)} disabled={submitting} className="action-card action-card-secondary">
        <div className="flex items-start justify-between">
          <span className="icon-tile">
            {submitting ? (
              <Loader2 size={20} className="animate-spin" style={{ color: "var(--icon-active)" }} />
            ) : (
              <Rocket size={20} style={{ color: "var(--icon-active)" }} />
            )}
          </span>
        </div>
        <span className="text-md font-semibold">{submitting ? "Creating…" : "Create campaign"}</span>
      </button>

      {error && (
        <p className="alert alert-error mt-2" role="alert">
          {error}
        </p>
      )}

      {result && (
        <div className="alert mt-2" aria-live="polite">
          <div>
            <p className="alert-title">
              Created {result.campaigns.length} campaign{result.campaigns.length === 1 ? "" : "s"} — {result.totalDailyBudget.toFixed(2)}/day total
            </p>
            <ul className="meta-line text-xs mt-1 space-y-0.5">
              {result.campaigns.map((c) => (
                <li key={c.id}>
                  {c.name} ({c.daily_budget.toFixed(2)}/day){!c.amazon_campaign_id && " — needs Amazon ID after upload"}
                </li>
              ))}
            </ul>
            {result.downloadUrl && (
              <a href={result.downloadUrl} className="btn btn-tertiary btn-sm mt-2">
                Download bulksheet
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
