"use client";

import Link from "next/link";
import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import { buildCampaignName } from "@/lib/naming";

const MARKETPLACES = ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const;

interface HarvestSummary {
  promoted: number;
  negated: number;
  monitored: number;
  lowImpressions: number;
  junk: number;
  total: number;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Harvest() {
  const [file, setFile] = useState<File | null>(null);

  const [asin, setAsin] = useState("");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("US");
  const [creatorInitials, setCreatorInitials] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [variant, setVariant] = useState("2");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [startDate, setStartDate] = useState(todayIso());

  const [useRrpBidding, setUseRrpBidding] = useState(true);
  const [rrp, setRrp] = useState("14.99");
  const [targetAcosPct, setTargetAcosPct] = useState("35");
  const [estConversionRatePct, setEstConversionRatePct] = useState("8");
  const [defaultBid, setDefaultBid] = useState("0.75");

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [minImpressions, setMinImpressions] = useState("300");
  const [minClicksToNegate, setMinClicksToNegate] = useState("8");
  const [minOrdersToPromote, setMinOrdersToPromote] = useState("1");

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<HarvestSummary | null>(null);
  const [resultCampaignName, setResultCampaignName] = useState<string | null>(null);

  const previewName = useMemo(() => {
    if (!asin.trim() || !creatorInitials.trim() || !authorName.trim() || !bookTitle.trim()) return null;
    return buildCampaignName({
      asin: asin.trim().toUpperCase(),
      marketplace,
      campaignType: "SPM",
      creatorInitials: creatorInitials.trim(),
      authorName: authorName.trim(),
      bookTitle: bookTitle.trim(),
      seriesName: seriesName.trim() || undefined,
      variant: Number(variant) || 1,
    });
  }, [asin, marketplace, creatorInitials, authorName, bookTitle, seriesName, variant]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setErrorMessage("Attach a Search Term report (.xlsx or .csv) first.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);
    setSummary(null);
    setResultCampaignName(null);

    try {
      const form = new FormData();
      form.set("file", file);
      form.set("asin", asin);
      form.set("marketplace", marketplace);
      form.set("creatorInitials", creatorInitials);
      form.set("authorName", authorName);
      form.set("bookTitle", bookTitle);
      if (seriesName) form.set("seriesName", seriesName);
      form.set("variant", variant);
      form.set("dailyBudget", dailyBudget);
      form.set("startDate", startDate);
      form.set("targetAcos", (Number(targetAcosPct) / 100).toString());
      if (useRrpBidding) {
        form.set("rrp", rrp);
        form.set("estConversionRate", (Number(estConversionRatePct) / 100).toString());
      } else {
        form.set("defaultBid", defaultBid);
      }
      if (showAdvanced) {
        form.set("minImpressionsForSignal", minImpressions);
        form.set("minClicksToNegate", minClicksToNegate);
        form.set("minOrdersToPromote", minOrdersToPromote);
      }

      const res = await fetch("/api/harvest", { method: "POST", body: form });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setErrorMessage(errBody.error ?? `Request failed (${res.status}).`);
        if (errBody.summary) setSummary(errBody.summary);
        setStatus("error");
        return;
      }

      const summaryHeader = res.headers.get("X-Harvest-Summary");
      const campaignNameHeader = res.headers.get("X-Campaign-Name");
      if (summaryHeader) setSummary(JSON.parse(decodeURIComponent(summaryHeader)));
      if (campaignNameHeader) setResultCampaignName(decodeURIComponent(campaignNameHeader));

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "harvest-bulksheet.xlsx";

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("success");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const isLoading = status === "loading";

  return (
    <main className="flex-1 flex justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-semibold">Harvest Search Terms</h1>
          <Link href="/" className="text-xs underline text-neutral-500 hover:text-neutral-700">
            ← Back to generator
          </Link>
        </div>
        <p className="text-sm text-neutral-500 mb-8">
          Upload the Search Term report from a running Auto (or Manual) campaign. Terms
          that converted get promoted to exact-match keywords (or product targets, for
          bare-ASIN terms), terms that spent without converting get negative-matched, and
          everything else is left alone pending more data.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Search Term Report (.xlsx or .csv)">
            <input required type="file" accept=".xlsx,.csv" onChange={handleFileChange} className="input" />
          </Field>

          <Field label="ASIN">
            <input
              required
              value={asin}
              onChange={(e) => setAsin(e.target.value)}
              placeholder="B0XXXXXXXX"
              maxLength={10}
              className="input"
            />
          </Field>

          <Field label="Marketplace">
            <select
              value={marketplace}
              onChange={(e) => setMarketplace(e.target.value as typeof marketplace)}
              className="input"
            >
              {MARKETPLACES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Creator Initials">
              <input
                required
                value={creatorInitials}
                onChange={(e) => setCreatorInitials(e.target.value)}
                placeholder="MO"
                className="input"
              />
            </Field>
            <Field label="Variant / Copy #">
              <input
                required
                type="number"
                min="1"
                step="1"
                value={variant}
                onChange={(e) => setVariant(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label="Author Name">
            <input
              required
              value={authorName}
              onChange={(e) => setAuthorName(e.target.value)}
              placeholder="Andrew Raymond"
              className="input"
            />
          </Field>

          <Field label="Book Title">
            <input
              required
              value={bookTitle}
              onChange={(e) => setBookTitle(e.target.value)}
              placeholder="The Long Isle"
              className="input"
            />
          </Field>

          <Field label="Series Name (optional)">
            <input
              value={seriesName}
              onChange={(e) => setSeriesName(e.target.value)}
              placeholder="A DC Mairead Maclean Mystery"
              className="input"
            />
          </Field>

          {previewName && (
            <p className="text-xs text-neutral-500 -mt-3">
              Output campaign name: <code className="text-neutral-700 dark:text-neutral-300">{previewName}</code>
            </p>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Daily Budget ($)">
              <input
                required
                type="number"
                min="1"
                step="0.01"
                value={dailyBudget}
                onChange={(e) => setDailyBudget(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Start Date">
              <input
                required
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label="Target ACOS (%)">
            <input
              required
              type="number"
              min="1"
              max="100"
              step="1"
              value={targetAcosPct}
              onChange={(e) => setTargetAcosPct(e.target.value)}
              className="input"
            />
            <span className="block text-xs text-neutral-500 mt-1">
              Used both as the promotion cutoff (terms at or below this ACOS get
              promoted) and, if deriving bids from RRP, as the bid cap input.
            </span>
          </Field>

          <Field label="Bid economics">
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={useRrpBidding} onChange={() => setUseRrpBidding(true)} />
                  Derive from RRP
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={!useRrpBidding} onChange={() => setUseRrpBidding(false)} />
                  Manual default bid
                </label>
              </div>

              {useRrpBidding ? (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs text-neutral-500 mb-1">RRP ($)</span>
                    <input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={rrp}
                      onChange={(e) => setRrp(e.target.value)}
                      className="input"
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs text-neutral-500 mb-1">Est. conv. rate (%)</span>
                    <input
                      required
                      type="number"
                      min="0.1"
                      max="100"
                      step="0.1"
                      value={estConversionRatePct}
                      onChange={(e) => setEstConversionRatePct(e.target.value)}
                      className="input"
                    />
                  </label>
                </div>
              ) : (
                <label className="block">
                  <span className="block text-xs text-neutral-500 mb-1">Default Bid ($)</span>
                  <input
                    required
                    type="number"
                    min="0.02"
                    step="0.01"
                    value={defaultBid}
                    onChange={(e) => setDefaultBid(e.target.value)}
                    className="input"
                  />
                </label>
              )}
            </div>
          </Field>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-xs underline text-neutral-500"
          >
            {showAdvanced ? "Hide" : "Show"} advanced thresholds
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-3 gap-3 rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
              <label className="block">
                <span className="block text-xs text-neutral-500 mb-1">Min impressions for signal</span>
                <input
                  type="number"
                  min="0"
                  value={minImpressions}
                  onChange={(e) => setMinImpressions(e.target.value)}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-neutral-500 mb-1">Min clicks to negate</span>
                <input
                  type="number"
                  min="0"
                  value={minClicksToNegate}
                  onChange={(e) => setMinClicksToNegate(e.target.value)}
                  className="input"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-neutral-500 mb-1">Min orders to promote</span>
                <input
                  type="number"
                  min="1"
                  value={minOrdersToPromote}
                  onChange={(e) => setMinOrdersToPromote(e.target.value)}
                  className="input"
                />
              </label>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? "Harvesting..." : "Harvest Bulksheet"}
          </button>
        </form>

        {status === "error" && errorMessage && (
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-sm text-red-800 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {status === "success" && (
          <div className="mt-6 rounded-md border border-green-300 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-4 text-sm text-green-800 dark:text-green-300">
            Download started{resultCampaignName ? ` — ${resultCampaignName}` : ""}.
          </div>
        )}

        {summary && (
          <div className="mt-4 text-xs text-neutral-500 space-y-1">
            <p className="font-medium text-neutral-600 dark:text-neutral-400">
              {summary.total} search terms classified
            </p>
            <div className="flex justify-between">
              <span>Promoted (exact keyword / product target)</span>
              <span className="text-green-600 dark:text-green-400">{summary.promoted}</span>
            </div>
            <div className="flex justify-between">
              <span>Negated (spent, no conversions)</span>
              <span>{summary.negated}</span>
            </div>
            <div className="flex justify-between">
              <span>Monitor (not enough signal yet)</span>
              <span>{summary.monitored}</span>
            </div>
            <div className="flex justify-between">
              <span>Low impressions</span>
              <span>{summary.lowImpressions}</span>
            </div>
            <div className="flex justify-between">
              <span>Junk (garbled / scraped artifacts)</span>
              <span>{summary.junk}</span>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          border-radius: 0.375rem;
          border: 1px solid var(--input-border, #d4d4d4);
          background: transparent;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
        }
        @media (prefers-color-scheme: dark) {
          .input {
            border-color: #404040;
          }
        }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium mb-1.5">{label}</span>
      {children}
    </label>
  );
}
