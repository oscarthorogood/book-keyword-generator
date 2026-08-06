"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { buildCampaignName } from "@/lib/naming";

type MatchType = "broad" | "phrase" | "exact";
type CampaignType = "SPA" | "SPM";

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
  const [campaignType, setCampaignType] = useState<CampaignType>("SPA");
  const [creatorInitials, setCreatorInitials] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [variant, setVariant] = useState("1");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [startDate, setStartDate] = useState(todayIso());
  const [matchTypes, setMatchTypes] = useState<MatchType[]>(["broad", "phrase", "exact"]);

  const [useRrpBidding, setUseRrpBidding] = useState(true);
  const [rrp, setRrp] = useState("14.99");
  const [targetAcosPct, setTargetAcosPct] = useState("35");
  const [estConversionRatePct, setEstConversionRatePct] = useState("8");
  const [defaultBid, setDefaultBid] = useState("0.75");

  const [autofillStatus, setAutofillStatus] = useState<"idle" | "loading" | "error">("idle");
  const [autofillError, setAutofillError] = useState<string | null>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [tropesKeywordCount, setTropesKeywordCount] = useState<number | null>(null);
  const [compNameKeywordCount, setCompNameKeywordCount] = useState<number | null>(null);
  const [productTargetCount, setProductTargetCount] = useState<number | null>(null);
  const [recommendedRange, setRecommendedRange] = useState<string | null>(null);
  const [resultCampaignName, setResultCampaignName] = useState<string | null>(null);

  const previewName = useMemo(() => {
    if (!asin.trim() || !creatorInitials.trim() || !authorName.trim() || !bookTitle.trim()) return null;
    return buildCampaignName({
      asin: asin.trim().toUpperCase(),
      marketplace,
      campaignType,
      creatorInitials: creatorInitials.trim(),
      authorName: authorName.trim(),
      bookTitle: bookTitle.trim(),
      seriesName: seriesName.trim() || undefined,
      variant: Number(variant) || 1,
    });
  }, [asin, marketplace, campaignType, creatorInitials, authorName, bookTitle, seriesName, variant]);

  function toggleMatchType(value: MatchType) {
    setMatchTypes((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  async function handleAutofill() {
    const trimmed = asin.trim().toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(trimmed)) {
      setAutofillError("Enter a valid 10-character ASIN first.");
      setAutofillStatus("error");
      return;
    }

    setAutofillStatus("loading");
    setAutofillError(null);

    try {
      const res = await fetch(
        `/api/lookup?asin=${encodeURIComponent(trimmed)}&marketplace=${marketplace}`
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAutofillError(body.error ?? `Lookup failed (${res.status}).`);
        setAutofillStatus("error");
        return;
      }

      if (body.title) setBookTitle(body.title);
      if (body.author) setAuthorName(body.author);
      if (body.seriesName) setSeriesName(body.seriesName);
      if (typeof body.price === "number") {
        setRrp(body.price.toFixed(2));
        setUseRrpBidding(true);
      }

      setAutofillStatus("idle");
    } catch (err) {
      setAutofillError(err instanceof Error ? err.message : "Something went wrong.");
      setAutofillStatus("error");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMessage(null);
    setSources(null);
    setTropesKeywordCount(null);
    setCompNameKeywordCount(null);
    setProductTargetCount(null);
    setRecommendedRange(null);
    setResultCampaignName(null);

    try {
      const body: Record<string, unknown> = {
        asin,
        marketplace,
        campaignType,
        creatorInitials,
        authorName,
        bookTitle,
        seriesName: seriesName || undefined,
        variant: Number(variant) || 1,
        dailyBudget: Number(dailyBudget),
        startDate,
        matchTypes,
      };
      if (useRrpBidding) {
        body.bidEconomics = {
          rrp: Number(rrp),
          targetAcos: Number(targetAcosPct) / 100,
          estConversionRate: Number(estConversionRatePct) / 100,
        };
      } else {
        body.defaultBid = Number(defaultBid);
      }

      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setErrorMessage(errBody.error ?? `Request failed (${res.status}).`);
        setSources(errBody.sources ?? null);
        setStatus("error");
        return;
      }

      const sourceHeader = res.headers.get("X-Source-Status");
      const tropesHeader = res.headers.get("X-Tropes-Keyword-Count");
      const compNameHeader = res.headers.get("X-Comp-Name-Keyword-Count");
      const productTargetHeader = res.headers.get("X-Product-Target-Count");
      const rangeHeader = res.headers.get("X-Recommended-Keyword-Range");
      const campaignNameHeader = res.headers.get("X-Campaign-Name");
      if (sourceHeader) setSources(JSON.parse(decodeURIComponent(sourceHeader)));
      if (tropesHeader) setTropesKeywordCount(Number(tropesHeader));
      if (compNameHeader) setCompNameKeywordCount(Number(compNameHeader));
      if (productTargetHeader) setProductTargetCount(Number(productTargetHeader));
      if (rangeHeader) setRecommendedRange(rangeHeader);
      if (campaignNameHeader) setResultCampaignName(decodeURIComponent(campaignNameHeader));

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
  const isAuto = campaignType === "SPA";

  return (
    <main className="flex-1 flex justify-center px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-semibold">Amazon Book Ads Builder</h1>
          <Link href="/harvest" className="text-xs underline text-neutral-500 hover:text-neutral-700">
            Harvest a Search Term report →
          </Link>
        </div>
        <p className="text-sm text-neutral-500 mb-8">
          Launch a cheap Auto campaign first to discover what customers actually search
          for, then come back and harvest the search term report into a Manual campaign.
          Every campaign follows the <code>PB_...</code> naming convention so downstream
          tooling can parse ASIN/Author back out of the name alone.
        </p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <Field label="Campaign Type">
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={campaignType === "SPA"}
                  onChange={() => setCampaignType("SPA")}
                />
                Auto (SPA) — cold-start discovery
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={campaignType === "SPM"}
                  onChange={() => setCampaignType("SPM")}
                />
                Manual (SPM) — keyword/product targeting
              </label>
            </div>
          </Field>

          <Field label="ASIN">
            <div className="flex gap-2">
              <input
                required
                value={asin}
                onChange={(e) => setAsin(e.target.value)}
                placeholder="B0XXXXXXXX"
                maxLength={10}
                className="input"
              />
              <button
                type="button"
                onClick={handleAutofill}
                disabled={autofillStatus === "loading"}
                className="shrink-0 rounded-md border border-neutral-300 dark:border-neutral-700 px-3 text-sm disabled:opacity-50"
              >
                {autofillStatus === "loading" ? "Looking up…" : "Autofill"}
              </button>
            </div>
            <span className="block text-xs text-neutral-500 mt-1">
              Scrapes the product page to fill in Author, Title, Series, and RRP below.
            </span>
            {autofillStatus === "error" && autofillError && (
              <span className="block text-xs text-red-600 dark:text-red-400 mt-1">{autofillError}</span>
            )}
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
              Campaign name: <code className="text-neutral-700 dark:text-neutral-300">{previewName}</code>
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
                <div className="grid grid-cols-3 gap-3">
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
                    <span className="block text-xs text-neutral-500 mb-1">Target ACOS (%)</span>
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

          {isAuto ? (
            <p className="text-xs text-neutral-500 rounded-md border border-neutral-200 dark:border-neutral-800 p-3">
              Auto campaigns don&apos;t take keywords — Amazon&apos;s engine targets
              automatically via close-match/loose-match/substitutes/complements. This
              just launches the campaign with tiered bids on those 4 default clauses.
              Run this first, let it collect data, then harvest its search term report.
            </p>
          ) : (
            <Field label="Match Types (Tropes & Themes ad group)">
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
              <span className="block text-xs text-neutral-500 mt-1">
                Applies to the Tropes &amp; Themes ad group only. Comp Authors &amp;
                Titles is always Exact Match — readers searching a name are ready to
                buy, so it isn&apos;t diluted with Broad/Phrase.
              </span>
            </Field>
          )}

          <button
            type="submit"
            disabled={isLoading || (!isAuto && matchTypes.length === 0)}
            className="w-full rounded-md bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 py-2.5 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? "Generating..." : `Generate ${isAuto ? "Auto" : "Manual"} Bulksheet`}
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
            tropesKeywordCount !== null && recommendedMin !== null && tropesKeywordCount < recommendedMin;
          return (
            <div
              className={`mt-6 rounded-md border p-4 text-sm ${
                belowRecommendedMin
                  ? "border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:border-amber-900 dark:text-amber-300"
                  : "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:border-green-900 dark:text-green-300"
              }`}
            >
              Download started
              {resultCampaignName ? ` — ${resultCampaignName}` : ""}.
              {isAuto ? (
                " Auto campaign with tiered clause bids."
              ) : (
                <>
                  {" "}
                  {tropesKeywordCount ?? 0} Tropes &amp; Themes keywords, {compNameKeywordCount ?? 0} Comp
                  Authors &amp; Titles keywords, {productTargetCount ?? 0} product targets
                  {recommendedRange ? ` (Amazon recommends ${recommendedRange} per ad group)` : ""}.
                </>
              )}
              {belowRecommendedMin &&
                " Tropes & Themes is below Amazon's recommended minimum — free sources came up short for this ASIN; consider adding a few keywords manually before uploading."}
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
