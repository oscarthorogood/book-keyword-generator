"use client";

import { FormEvent, useMemo, useState } from "react";
import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { buildCampaignName } from "@/lib/naming";

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

  // Book profile gathered by Autofill — genre/subgenre path, Best Sellers
  // Rank standings, description, and a combined, prunable tag list from
  // every free source (Amazon categories, Google Books, Open Library,
  // Goodreads). The reviewed tag list feeds keyword generation as
  // knownTags — see buildKnownTagCandidates in lib/keywordMerge.ts.
  const [profileCategoryPath, setProfileCategoryPath] = useState<string[]>([]);
  const [profileBestSellerRanks, setProfileBestSellerRanks] = useState<
    { rank: number; category: string }[]
  >([]);
  const [profileDescription, setProfileDescription] = useState<string | null>(null);
  const [profileTags, setProfileTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [tropesKeywordCount, setTropesKeywordCount] = useState<number | null>(null);
  const [compNameKeywordCount, setCompNameKeywordCount] = useState<number | null>(null);
  const [productTargetCount, setProductTargetCount] = useState<number | null>(null);
  const [recommendedRange, setRecommendedRange] = useState<string | null>(null);
  const [resultCampaignName, setResultCampaignName] = useState<string | null>(null);
  const [aiRankingUsed, setAiRankingUsed] = useState<boolean>(false);

  const previewName = useMemo(() => {
    const normalizedAsin = normalizeAsinOrIsbn(asin);
    if (!normalizedAsin || !creatorInitials.trim() || !authorName.trim() || !bookTitle.trim()) return null;
    return buildCampaignName({
      asin: normalizedAsin,
      marketplace,
      creatorInitials: creatorInitials.trim(),
      authorName: authorName.trim(),
      bookTitle: bookTitle.trim(),
      seriesName: seriesName.trim() || undefined,
      variant: Number(variant) || 1,
    });
  }, [asin, marketplace, creatorInitials, authorName, bookTitle, seriesName, variant]);

  function toggleMatchType(value: MatchType) {
    setMatchTypes((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  async function handleAutofill() {
    const normalized = normalizeAsinOrIsbn(asin);
    if (!normalized) {
      setAutofillError("Enter a valid ASIN, ISBN-10, or ISBN-13 first.");
      setAutofillStatus("error");
      return;
    }

    setAutofillStatus("loading");
    setAutofillError(null);

    try {
      const res = await fetch(
        `/api/lookup?asin=${encodeURIComponent(normalized)}&marketplace=${marketplace}`
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        setAutofillError(body.error ?? `Lookup failed (${res.status}).`);
        setAutofillStatus("error");
        return;
      }

      if (body.asin) setAsin(body.asin);
      if (body.title) setBookTitle(body.title);
      if (body.author) setAuthorName(body.author);
      if (body.seriesName) setSeriesName(body.seriesName);
      if (typeof body.price === "number") {
        setRrp(body.price.toFixed(2));
        setUseRrpBidding(true);
      }
      setProfileCategoryPath(Array.isArray(body.categoryPath) ? body.categoryPath : []);
      setProfileBestSellerRanks(Array.isArray(body.bestSellerRanks) ? body.bestSellerRanks : []);
      setProfileDescription(typeof body.description === "string" ? body.description : null);
      setProfileTags(Array.isArray(body.tags) ? body.tags : []);

      setAutofillStatus("idle");
    } catch (err) {
      setAutofillError(err instanceof Error ? err.message : "Something went wrong.");
      setAutofillStatus("error");
    }
  }

  function removeTag(tag: string) {
    setProfileTags((prev) => prev.filter((t) => t !== tag));
  }

  function addTag() {
    const trimmed = newTagInput.trim().toLowerCase();
    if (trimmed && !profileTags.includes(trimmed)) {
      setProfileTags((prev) => [...prev, trimmed]);
    }
    setNewTagInput("");
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
        creatorInitials,
        authorName,
        bookTitle,
        seriesName: seriesName || undefined,
        variant: Number(variant) || 1,
        dailyBudget: Number(dailyBudget),
        startDate,
        matchTypes,
        knownTags: profileTags,
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
      const aiRankingHeader = res.headers.get("X-Ai-Ranking-Used");
      if (sourceHeader) setSources(JSON.parse(decodeURIComponent(sourceHeader)));
      if (tropesHeader) setTropesKeywordCount(Number(tropesHeader));
      if (compNameHeader) setCompNameKeywordCount(Number(compNameHeader));
      if (productTargetHeader) setProductTargetCount(Number(productTargetHeader));
      if (rangeHeader) setRecommendedRange(rangeHeader);
      if (campaignNameHeader) setResultCampaignName(decodeURIComponent(campaignNameHeader));
      setAiRankingUsed(aiRankingHeader === "true");

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

  const [recommendedMin] = recommendedRange?.split("-").map(Number) ?? [null];
  const belowRecommendedMin =
    tropesKeywordCount !== null && recommendedMin !== null && tropesKeywordCount < recommendedMin;

  return (
    <main className="flex-1 flex justify-center px-3 py-6 md:px-6 md:py-10">
      <div className="w-full max-w-6xl shell p-4 md:p-8">
        {/* Topbar */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="logo-mark">PB</div>
            <div>
              <p className="brand-title text-base md:text-lg">Amazon Book Ads Builder</p>
              <p className="eyebrow">Manual campaign generator</p>
            </div>
          </div>
          <span className="btn-pill-outline hidden sm:inline-flex" style={{ cursor: "default" }}>
            Sponsored Products · Manual
          </span>
        </div>

        {/* Page heading */}
        <div className="mb-6 md:mb-8">
          <h1 className="page-heading text-2xl md:text-4xl">Build Campaign</h1>
          <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: "var(--muted)" }}>
            Enter an ASIN or ISBN to gather book metadata, scrape keyword candidates from
            every available source, and get an AI-reviewed shortlist ready for a Manual
            Sponsored Products campaign. Every campaign follows the{" "}
            <code className="font-mono text-xs" style={{ color: "var(--ink)" }}>PB_...</code> naming
            convention so downstream tooling can parse ASIN/Author back out of the name alone.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 md:gap-6 items-start">
            {/* Left column */}
            <div className="flex flex-col gap-5 md:gap-6">
              <div className="card">
                <p className="card-title mb-4">Book Lookup</p>

                <Field label="ASIN or ISBN">
                  <div className="flex gap-2">
                    <input
                      required
                      value={asin}
                      onChange={(e) => setAsin(e.target.value)}
                      placeholder="B0XXXXXXXX or 978XXXXXXXXXX"
                      maxLength={17}
                      className="input"
                    />
                    <button
                      type="button"
                      onClick={handleAutofill}
                      disabled={autofillStatus === "loading"}
                      className="btn-pill-outline shrink-0"
                    >
                      {autofillStatus === "loading" ? "Looking up…" : "Autofill"}
                    </button>
                  </div>
                  <span className="field-hint">
                    Scrapes the product page to fill in Author, Title, Series, and RRP.
                  </span>
                  {autofillStatus === "error" && autofillError && (
                    <span className="field-hint" style={{ color: "var(--accent-red)" }}>
                      {autofillError}
                    </span>
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
              </div>

              {(profileCategoryPath.length > 0 ||
                profileBestSellerRanks.length > 0 ||
                profileDescription ||
                profileTags.length > 0) && (
                <div className="card">
                  <p className="card-title mb-4">Book Profile</p>

                  <div className="space-y-3">
                    {profileCategoryPath.length > 0 && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Category: </span>
                        {profileCategoryPath.join(" › ")}
                      </p>
                    )}

                    {profileBestSellerRanks.length > 0 && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Best Sellers Rank: </span>
                        {profileBestSellerRanks
                          .map((r) => `#${r.rank.toLocaleString()} in ${r.category}`)
                          .join(", ")}
                      </p>
                    )}

                    {profileDescription && (
                      <p className="text-xs leading-relaxed line-clamp-3" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Description: </span>
                        {profileDescription}
                      </p>
                    )}

                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>
                        Tags ({profileTags.length}) — reviewed here feed keyword generation
                        directly. Remove any that don&apos;t fit.
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {profileTags.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => removeTag(tag)}
                            title="Remove tag"
                            className="chip-tag"
                          >
                            {tag} ×
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={newTagInput}
                          onChange={(e) => setNewTagInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addTag();
                            }
                          }}
                          placeholder="Add a tag"
                          className="input text-xs"
                        />
                        <button type="button" onClick={addTag} className="btn-pill-outline shrink-0 text-xs">
                          Add
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Right column */}
            <div className="flex flex-col gap-5 md:gap-6">
              <div className="card">
                <p className="card-title mb-4">Campaign Details</p>
                <div className="space-y-5">
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
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      Campaign name:{" "}
                      <code className="chip-tag" style={{ cursor: "default" }}>{previewName}</code>
                    </p>
                  )}
                </div>
              </div>

              <div className="card">
                <p className="card-title mb-4">Budget &amp; Bid</p>
                <div className="space-y-5">
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
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="option-card">
                          <input
                            type="radio"
                            className="mt-0.5"
                            checked={useRrpBidding}
                            onChange={() => setUseRrpBidding(true)}
                          />
                          <span>
                            Derive from RRP
                            <span
                              className="block text-xs font-normal mt-0.5"
                              style={{ color: "var(--muted)" }}
                            >
                              Max CPC computed from RRP × ACOS × conv. rate
                            </span>
                          </span>
                        </label>
                        <label className="option-card">
                          <input
                            type="radio"
                            className="mt-0.5"
                            checked={!useRrpBidding}
                            onChange={() => setUseRrpBidding(false)}
                          />
                          <span>
                            Manual default bid
                            <span
                              className="block text-xs font-normal mt-0.5"
                              style={{ color: "var(--muted)" }}
                            >
                              Set a flat starting bid yourself
                            </span>
                          </span>
                        </label>
                      </div>

                      {useRrpBidding ? (
                        <div className="grid grid-cols-3 gap-3">
                          <label className="block">
                            <span className="field-hint" style={{ marginTop: 0, marginBottom: "0.35rem" }}>
                              RRP ($)
                            </span>
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
                            <span className="field-hint" style={{ marginTop: 0, marginBottom: "0.35rem" }}>
                              Target ACOS (%)
                            </span>
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
                            <span className="field-hint" style={{ marginTop: 0, marginBottom: "0.35rem" }}>
                              Est. conv. rate (%)
                            </span>
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
                        <label className="block max-w-[220px]">
                          <span className="field-hint" style={{ marginTop: 0, marginBottom: "0.35rem" }}>
                            Default Bid ($)
                          </span>
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
                </div>
              </div>

              <div className="card">
                <p className="card-title mb-4">Match Types</p>
                <p className="field-hint mb-3" style={{ marginTop: 0 }}>
                  Applies to the Tropes &amp; Themes ad group only. Comp Authors &amp; Titles
                  is always Exact Match — readers searching a name are ready to buy, so it
                  isn&apos;t diluted with Broad/Phrase.
                </p>
                <div className="flex flex-wrap gap-2">
                  {MATCH_TYPES.map(({ value, label }) => (
                    <label key={value} className="chip-toggle">
                      <input
                        type="checkbox"
                        checked={matchTypes.includes(value)}
                        onChange={() => toggleMatchType(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading || matchTypes.length === 0}
                className="btn-pill-dark w-full py-3 text-sm"
              >
                {isLoading ? "Generating…" : "Generate Manual Bulksheet"}
              </button>
            </div>
          </div>
        </form>

        {status === "error" && errorMessage && (
          <div
            className="status-banner mt-6"
            style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
          >
            <span className="status-dot" style={{ background: "var(--accent-red)" }} />
            <span style={{ color: "var(--accent-red)" }}>{errorMessage}</span>
          </div>
        )}

        {status === "success" && (
          <div className="mt-8 space-y-5">
            <div
              className="status-banner"
              style={{
                background: belowRecommendedMin ? "var(--accent-yellow-soft)" : "var(--accent-green-soft)",
                borderColor: belowRecommendedMin ? "var(--accent-yellow)" : "var(--accent-green)",
              }}
            >
              <span
                className="status-dot"
                style={{ background: belowRecommendedMin ? "var(--accent-yellow)" : "var(--accent-green)" }}
              />
              <span style={{ color: belowRecommendedMin ? "var(--accent-yellow)" : "var(--accent-green)" }}>
                Download started
                {resultCampaignName ? ` — ${resultCampaignName}` : ""}.{" "}
                {recommendedRange ? `Amazon recommends ${recommendedRange} keywords per ad group. ` : ""}
                {aiRankingUsed
                  ? "AI-ranked (Gemini)."
                  : "Heuristic-ranked (set GEMINI_API_KEY to enable AI ranking)."}
                {belowRecommendedMin &&
                  " Tropes & Themes is below Amazon's recommended minimum — free sources came up short for this ASIN; consider adding a few keywords manually before uploading."}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="stat-tile tone-purple">
                <span className="stat-value">{tropesKeywordCount ?? 0}</span>
                <span className="stat-label">Tropes &amp; Themes</span>
              </div>
              <div className="stat-tile tone-green">
                <span className="stat-value">{compNameKeywordCount ?? 0}</span>
                <span className="stat-label">Comp Authors &amp; Titles</span>
              </div>
              <div className="stat-tile tone-yellow">
                <span className="stat-value">{productTargetCount ?? 0}</span>
                <span className="stat-label">Product Targets</span>
              </div>
              <div className="stat-tile tone-purple">
                <span className="stat-value">{aiRankingUsed ? "AI" : "Heuristic"}</span>
                <span className="stat-label">Ranking Method</span>
              </div>
            </div>
          </div>
        )}

        {sources && (
          <div className="card mt-5">
            <p className="card-title mb-3">Sources</p>
            {sources.map((s) => (
              <div key={s.source} className="source-row">
                <span className="flex items-center gap-2">
                  <span
                    className="status-dot"
                    style={{
                      marginTop: 0,
                      background: s.ok ? "var(--accent-green)" : "var(--line)",
                    }}
                  />
                  {s.source}
                </span>
                <span style={{ color: s.ok ? "var(--accent-green)" : "var(--muted)" }}>
                  {s.ok ? `${s.count ?? ""} found` : s.error ?? "no results"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
