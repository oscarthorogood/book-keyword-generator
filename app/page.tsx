"use client";

import { FormEvent, useState } from "react";

type MatchType = "broad" | "phrase" | "exact";

const MARKETPLACES = ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const;
const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "broad", label: "Broad" },
  { value: "phrase", label: "Phrase" },
  { value: "exact", label: "Exact" },
];

interface SourceStatus {
  source: string;
  ok: boolean;
  count?: number;
  error?: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function Home() {
  const [asin, setAsin] = useState("");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("US");
  const [campaignName, setCampaignName] = useState("");
  const [adGroupName, setAdGroupName] = useState("");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [startDate, setStartDate] = useState(todayIso());
  const [defaultBid, setDefaultBid] = useState("0.75");
  const [matchTypes, setMatchTypes] = useState<MatchType[]>(["broad", "phrase", "exact"]);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [keywordCount, setKeywordCount] = useState<number | null>(null);
  const [recommendedRange, setRecommendedRange] = useState<string | null>(null);

  function toggleMatchType(value: MatchType) {
    setMatchTypes((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage(null);
    setSources(null);
    setKeywordCount(null);
    setRecommendedRange(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asin,
          marketplace,
          campaignName,
          adGroupName,
          dailyBudget: Number(dailyBudget),
          startDate,
          defaultBid: Number(defaultBid),
          matchTypes,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErrorMessage(body.error ?? `Request failed (${res.status}).`);
        setSources(body.sources ?? null);
        setStatus("error");
        return;
      }

      const sourceHeader = res.headers.get("X-Source-Status");
      const countHeader = res.headers.get("X-Keyword-Count");
      const rangeHeader = res.headers.get("X-Recommended-Keyword-Range");
      if (sourceHeader) setSources(JSON.parse(decodeURIComponent(sourceHeader)));
      if (countHeader) setKeywordCount(Number(countHeader));
      if (rangeHeader) setRecommendedRange(rangeHeader);

      const disposition = res.headers.get("Content-Disposition") ?? "";
      const filenameMatch = disposition.match(/filename="([^"]+)"/);
      const filename = filenameMatch?.[1] ?? "bulksheet.xlsx";

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
        <h1 className="text-2xl font-semibold mb-1">Amazon Book Keyword Tool</h1>
        <p className="text-sm text-neutral-500 mb-8">
          Enter an ASIN and campaign settings. You&apos;ll get back a Bulksheet-ready
          .xlsx file to upload into Amazon Ads&apos; bulk operations tool.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
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

          <Field label="Campaign Name">
            <input
              required
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Book Title - Manual - SP"
              className="input"
            />
          </Field>

          <Field label="Ad Group Name">
            <input
              required
              value={adGroupName}
              onChange={(e) => setAdGroupName(e.target.value)}
              placeholder="Keywords"
              className="input"
            />
          </Field>

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
            <Field label="Default Bid ($)">
              <input
                required
                type="number"
                min="0.02"
                step="0.01"
                value={defaultBid}
                onChange={(e) => setDefaultBid(e.target.value)}
                className="input"
              />
            </Field>
          </div>

          <Field label="Start Date">
            <input
              required
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input"
            />
          </Field>

          <Field label="Match Types">
            <div className="flex gap-4">
              {MATCH_TYPES.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={matchTypes.includes(value)}
                    onChange={() => toggleMatchType(value)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </Field>

          <button
            type="submit"
            disabled={isLoading || matchTypes.length === 0}
            className="w-full rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? "Generating..." : "Generate Bulksheet"}
          </button>
        </form>

        {status === "error" && errorMessage && (
          <div className="mt-6 rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-900 p-4 text-sm text-red-800 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {status === "success" && (() => {
          const [recommendedMin] = recommendedRange?.split("-").map(Number) ?? [null];
          const belowRecommendedMin =
            keywordCount !== null && recommendedMin !== null && keywordCount < recommendedMin;
          return (
            <div
              className={`mt-6 rounded-md border p-4 text-sm ${
                belowRecommendedMin
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300"
                  : "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:border-green-900 dark:text-green-300"
              }`}
            >
              Download started — {keywordCount ?? "?"} keywords
              {recommendedRange ? ` (Amazon recommends ${recommendedRange} per ad group)` : ""}.
              {belowRecommendedMin &&
                " That's below Amazon's recommended minimum — free sources came up short for this ASIN; consider adding a few keywords manually before uploading."}
            </div>
          );
        })()}

        {sources && (
          <div className="mt-4 text-xs text-neutral-500 space-y-1">
            <p className="font-medium text-neutral-600 dark:text-neutral-400">Sources</p>
            {sources.map((s) => (
              <div key={s.source} className="flex justify-between gap-2">
                <span>{s.source}</span>
                <span className={s.ok ? "text-green-600 dark:text-green-400" : "text-neutral-400"}>
                  {s.ok ? `${s.count ?? ""} found` : s.error ?? "no results"}
                </span>
              </div>
            ))}
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
