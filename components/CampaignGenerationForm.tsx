"use client";

import { FormEvent, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { normalizeAsinOrIsbn } from "@/lib/isbn";
import { buildCampaignName } from "@/lib/naming";
import { KEYWORD_CATEGORY_META } from "@/lib/keywordCategories";
import { MATCH_TYPE_STRATEGIES } from "@/lib/matchTypeStrategy";
import type { KeywordCategory, KeywordGroupType, KeywordSource, MatchTypeStrategy } from "@/lib/types";

interface CampaignGenerationFormProps {
  onBack: () => void;
  bookId?: string;
}

type FormPage = 1 | 2 | 3 | 4 | 5 | 6;
const TOTAL_PAGES = 6;

const PAGE_TITLES: Record<FormPage, string> = {
  1: "Book Details",
  2: "Budget & Bid",
  3: "Keywords & Sources",
  4: "Strategy",
  5: "Preferences",
  6: "Review",
};

// Calculate estimated daily spend based on budget and strategy
function calculateEstimatedSpend(dailyBudget: number, strategyValue: MatchTypeStrategy | "custom"): { spend: number; multiplier: number } {
  let multiplier = 1;
  if (strategyValue === "phrase-exact") multiplier = 2;
  if (strategyValue === "all") multiplier = 3;

  // 50% utilization rate (not all keywords get clicks daily)
  const estimatedSpend = Number(dailyBudget) * 0.5;
  return { spend: estimatedSpend, multiplier };
}

type MatchType = "broad" | "phrase" | "exact";

const MARKETPLACES = ["US", "UK", "CA", "DE", "FR", "IT", "ES"] as const;
const MATCH_TYPES: { value: MatchType; label: string }[] = [
  { value: "broad", label: "Broad" },
  { value: "phrase", label: "Phrase" },
  { value: "exact", label: "Exact" },
];

// Mirrors ALL_KEYWORD_SOURCES in app/api/generate/route.ts — "manual" isn't
// here since search-bar additions are always guaranteed a slot, not toggled.
const KEYWORD_SOURCES: { value: KeywordSource; label: string }[] = [
  { value: "ads-api", label: "Amazon Ads API" },
  { value: "autocomplete", label: "Amazon Autocomplete" },
  { value: "google-autocomplete", label: "Google Autocomplete" },
  { value: "youtube-autocomplete", label: "YouTube Autocomplete" },
  { value: "duckduckgo-autocomplete", label: "DuckDuckGo Autocomplete" },
  { value: "comp-title", label: "Comp Title Categories" },
  { value: "comp-name", label: "Comp Author/Title Crawl" },
  { value: "amazon-recs", label: "Bought Together / Compare Similar" },
  { value: "firecrawl", label: "Firecrawl Page Extraction" },
  { value: "author-catalog", label: "Author's Other Books" },
  { value: "genre-metadata", label: "Genre & Subject Metadata" },
  { value: "buyer-intent", label: "Buyer-Intent Templates" },
  { value: "book-content", label: "Google Books Content Terms" },
  { value: "review-language", label: "Review Language Mining" },
  { value: "book-description", label: "Book Description / Blurb" },
  { value: "customer-qna", label: "Customer Q&A Mining" },
  { value: "synonym", label: "Synonym Expansion" },
  { value: "wikipedia", label: "Wikipedia Categories" },
  { value: "wikidata", label: "Wikidata Genres" },
  { value: "loc-subjects", label: "Library of Congress Subjects" },
  { value: "goodreads-tags", label: "Goodreads Tags" },
  { value: "user-tag", label: "Your Reviewed Tags" },
];

const KEYWORD_TYPES: { value: KeywordGroupType; label: string; hint: string }[] = [
  { value: "tropes", label: "Tropes & Themes", hint: "Genre/subject terms, buyer-intent phrasing, review-mined language" },
  { value: "comp-names", label: "Comp Authors & Titles", hint: "Bare comparable author/title names, exact match only" },
  { value: "product-targeting", label: "Product Targeting", hint: "Comparable ASINs, bid directly against their listings" },
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

export default function CampaignGenerationForm({ onBack, bookId }: CampaignGenerationFormProps) {
  const [currentPage, setCurrentPage] = useState<FormPage>(1);

  const [asin, setAsin] = useState("");
  const [marketplace, setMarketplace] = useState<(typeof MARKETPLACES)[number]>("US");
  const [creatorInitials, setCreatorInitials] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [bookTitle, setBookTitle] = useState("");
  const [seriesName, setSeriesName] = useState("");
  const [seriesOrder, setSeriesOrder] = useState("");
  const [seriesTotal, setSeriesTotal] = useState("");
  const [variant, setVariant] = useState("1");
  const [dailyBudget, setDailyBudget] = useState("10");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState("");
  const [campaignDuration, setCampaignDuration] = useState<"ongoing" | "limited">("ongoing");
  const [matchTypeStrategy, setMatchTypeStrategy] = useState<MatchTypeStrategy | "custom">("all");
  const [matchTypes, setMatchTypes] = useState<MatchType[]>(["broad", "phrase", "exact"]);

  const [selectedSources, setSelectedSources] = useState<KeywordSource[]>(
    KEYWORD_SOURCES.map((s) => s.value)
  );
  const [selectedKeywordTypes, setSelectedKeywordTypes] = useState<KeywordGroupType[]>(
    KEYWORD_TYPES.map((t) => t.value)
  );
  const [selectedKeywordCategories, setSelectedKeywordCategories] = useState<KeywordCategory[]>(
    KEYWORD_CATEGORY_META.map((c) => c.value)
  );
  const [keyTropes, setKeyTropes] = useState<string[]>([]);
  const [keyTropesInput, setKeyTropesInput] = useState("");
  const [manualKeywords, setManualKeywords] = useState<string[]>([]);
  const [manualKeywordInput, setManualKeywordInput] = useState("");

  const [useRrpBidding, setUseRrpBidding] = useState(true);
  const [rrp, setRrp] = useState("14.99");
  const [targetAcosPct, setTargetAcosPct] = useState("35");
  const [estConversionRatePct, setEstConversionRatePct] = useState("8");
  const [defaultBid, setDefaultBid] = useState("0.75");

  const [autofillStatus, setAutofillStatus] = useState<"idle" | "loading" | "error">("idle");
  const [autofillError, setAutofillError] = useState<string | null>(null);

  // Book profile gathered by Autofill — comprehensive metadata from the Amazon
  // product page and enriched via Google Books / Open Library / Goodreads.
  const [profileCategoryPath, setProfileCategoryPath] = useState<string[]>([]);
  const [profileBestSellerRanks, setProfileBestSellerRanks] = useState<
    { rank: number; category: string }[]
  >([]);
  const [profileDescription, setProfileDescription] = useState<string | null>(null);
  const [profileBulletPoints, setProfileBulletPoints] = useState<string[]>([]);
  const [profileCompTitles, setProfileCompTitles] = useState<string[]>([]);
  const [profileIsbn10, setProfileIsbn10] = useState<string | null>(null);
  const [profileIsbn13, setProfileIsbn13] = useState<string | null>(null);
  const [profilePrice, setProfilePrice] = useState<number | null>(null);
  const [profileRating, setProfileRating] = useState<number | null>(null);
  const [profileReviewCount, setProfileReviewCount] = useState<number | null>(null);
  const [profilePageCount, setProfilePageCount] = useState<number | null>(null);
  const [profilePublisher, setProfilePublisher] = useState<string | null>(null);
  const [profilePublicationDate, setProfilePublicationDate] = useState<string | null>(null);
  const [profileLanguage, setProfileLanguage] = useState<string | null>(null);
  const [profileDimensions, setProfileDimensions] = useState<string | null>(null);
  const [profileGoogleBooksCategories, setProfileGoogleBooksCategories] = useState<string[]>([]);
  const [profileOpenLibrarySubjects, setProfileOpenLibrarySubjects] = useState<string[]>([]);
  const [profileGoodreadsTags, setProfileGoodreadsTags] = useState<string[]>([]);
  const [profileTags, setProfileTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");
  const [expandedMetadata, setExpandedMetadata] = useState(false);
  const [profileCoverImageUrl, setProfileCoverImageUrl] = useState<string | null>(null);
  const [profileQaCount, setProfileQaCount] = useState<number | null>(null);
  const [profileAvailability, setProfileAvailability] = useState<string | null>(null);
  const [profileCompDetails, setProfileCompDetails] = useState<
    Array<{ asin: string; title: string; author?: string; rating?: number; reviewCount?: number }>
  >([]);

  // Firecrawl-extracted metadata
  const [profileFirecrawlCategories, setProfileFirecrawlCategories] = useState<string[]>([]);
  const [profileFirecrawlFeatures, setProfileFirecrawlFeatures] = useState<string[]>([]);
  const [profileFirecrawlKeywords, setProfileFirecrawlKeywords] = useState<string[]>([]);

  // Metadata enrichment from various sources
  const [profileWikipediaCategories, setProfileWikipediaCategories] = useState<string[]>([]);
  const [profileWikidataGenres, setProfileWikidataGenres] = useState<string[]>([]);
  const [profileLocSubjects, setProfileLocSubjects] = useState<string[]>([]);

  // Amazon recommendation sections
  const [profileFrequentlyBoughtTogether, setProfileFrequentlyBoughtTogether] = useState<
    Array<{ asin: string; title: string }>
  >([]);
  const [profileCompareWithSimilar, setProfileCompareWithSimilar] = useState<
    Array<{ asin: string; title: string }>
  >([]);

  const [status, setStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [tropesKeywordCount, setTropesKeywordCount] = useState<number | null>(null);
  const [compNameKeywordCount, setCompNameKeywordCount] = useState<number | null>(null);
  const [productTargetCount, setProductTargetCount] = useState<number | null>(null);
  const [manualKeywordCount, setManualKeywordCount] = useState<number | null>(null);
  const [recommendedRange, setRecommendedRange] = useState<string | null>(null);
  const [resultCampaignName, setResultCampaignName] = useState<string | null>(null);
  const [aiRankingUsed, setAiRankingUsed] = useState<boolean>(false);
  // Signed link to the copy saved in Supabase Storage; null when archiving is
  // not configured or the upload failed (the direct download still happened).
  const [archiveUrl, setArchiveUrl] = useState<string | null>(null);

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

  function setStrategy(strategy: MatchTypeStrategy | "custom") {
    setMatchTypeStrategy(strategy);
    if (strategy !== "custom") {
      const strategyConfig = MATCH_TYPE_STRATEGIES[strategy];
      setMatchTypes(strategyConfig.matchTypes);
    }
  }

  function toggleMatchType(value: MatchType) {
    // When user manually toggles a match type, switch to "custom" mode
    setMatchTypeStrategy("custom");
    setMatchTypes((prev) =>
      prev.includes(value) ? prev.filter((m) => m !== value) : [...prev, value]
    );
  }

  function toggleSource(value: KeywordSource) {
    setSelectedSources((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]
    );
  }

  function toggleKeywordType(value: KeywordGroupType) {
    setSelectedKeywordTypes((prev) =>
      prev.includes(value) ? prev.filter((t) => t !== value) : [...prev, value]
    );
  }

  function toggleKeywordCategory(value: KeywordCategory) {
    setSelectedKeywordCategories((prev) =>
      prev.includes(value) ? prev.filter((c) => c !== value) : [...prev, value]
    );
  }

  function addKeyTrope() {
    const trimmed = keyTropesInput.trim();
    if (trimmed && !keyTropes.includes(trimmed)) {
      setKeyTropes((prev) => [...prev, trimmed]);
    }
    setKeyTropesInput("");
  }

  function removeKeyTrope(trope: string) {
    setKeyTropes((prev) => prev.filter((t) => t !== trope));
  }

  function addManualKeyword() {
    const trimmed = manualKeywordInput.trim().toLowerCase();
    if (trimmed && !manualKeywords.includes(trimmed)) {
      setManualKeywords((prev) => [...prev, trimmed]);
    }
    setManualKeywordInput("");
  }

  function removeManualKeyword(keyword: string) {
    setManualKeywords((prev) => prev.filter((k) => k !== keyword));
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
      setProfileBulletPoints(Array.isArray(body.bulletPoints) ? body.bulletPoints : []);
      setProfileCompTitles(Array.isArray(body.compTitles) ? body.compTitles.slice(0, 5) : []);
      setProfileIsbn10(typeof body.isbn10 === "string" ? body.isbn10 : null);
      setProfileIsbn13(typeof body.isbn13 === "string" ? body.isbn13 : null);
      setProfilePrice(typeof body.price === "number" ? body.price : null);
      setProfileRating(typeof body.rating === "number" ? body.rating : null);
      setProfileReviewCount(typeof body.reviewCount === "number" ? body.reviewCount : null);
      setProfilePageCount(typeof body.pageCount === "number" ? body.pageCount : null);
      setProfilePublisher(typeof body.publisher === "string" ? body.publisher : null);
      setProfilePublicationDate(typeof body.publicationDate === "string" ? body.publicationDate : null);
      setProfileLanguage(typeof body.language === "string" ? body.language : null);
      setProfileDimensions(typeof body.dimensions === "string" ? body.dimensions : null);
      setProfileGoogleBooksCategories(Array.isArray(body.googleBooksCategories) ? body.googleBooksCategories : []);
      setProfileOpenLibrarySubjects(Array.isArray(body.openLibrarySubjects) ? body.openLibrarySubjects : []);
      setProfileGoodreadsTags(Array.isArray(body.goodreadsTags) ? body.goodreadsTags : []);
      setProfileTags(Array.isArray(body.tags) ? body.tags : []);
      setProfileCoverImageUrl(typeof body.coverImageUrl === "string" ? body.coverImageUrl : null);
      setProfileQaCount(typeof body.qaCount === "number" ? body.qaCount : null);
      setProfileAvailability(typeof body.availability === "string" ? body.availability : null);
      setProfileCompDetails(Array.isArray(body.compDetails) ? body.compDetails : []);

      // Firecrawl metadata
      setProfileFirecrawlCategories(Array.isArray(body.firecrawlCategories) ? body.firecrawlCategories : []);
      setProfileFirecrawlFeatures(Array.isArray(body.firecrawlFeatures) ? body.firecrawlFeatures : []);
      setProfileFirecrawlKeywords(Array.isArray(body.firecrawlKeywords) ? body.firecrawlKeywords : []);

      // Enriched metadata from various sources
      setProfileWikipediaCategories(Array.isArray(body.wikipediaCategories) ? body.wikipediaCategories : []);
      setProfileWikidataGenres(Array.isArray(body.wikidataGenres) ? body.wikidataGenres : []);
      setProfileLocSubjects(Array.isArray(body.locSubjects) ? body.locSubjects : []);

      // Amazon recommendations
      setProfileFrequentlyBoughtTogether(Array.isArray(body.frequentlyBoughtTogether) ? body.frequentlyBoughtTogether : []);
      setProfileCompareWithSimilar(Array.isArray(body.compareWithSimilar) ? body.compareWithSimilar : []);

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

    if (!asin || !authorName || !bookTitle) {
      setErrorMessage("Please fill in ASIN, Author, and Title");
      return;
    }

    setStatus("loading");
    setErrorMessage(null);

    try {
      // Book-centric flow: if bookId provided, create campaign for that book
      // Otherwise, use legacy flow
      if (bookId) {
        // Create campaign for existing book
        const campaignName = `Campaign ${Number(variant) || 1}`;

        const res = await fetch("/api/campaigns/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookId,
            campaignName,
            variant: Number(variant) || 1,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          setErrorMessage(errBody.error ?? `Request failed (${res.status}).`);
          setStatus("error");
          return;
        }
      } else {
        // Legacy flow: create book and campaign together
        const normalizedAsin = normalizeAsinOrIsbn(asin);
        if (!normalizedAsin) {
          throw new Error("Invalid ASIN/ISBN format");
        }

        const campaignName = buildCampaignName({
          asin: normalizedAsin,
          marketplace,
          creatorInitials: creatorInitials || "XX",
          authorName,
          bookTitle,
          seriesName: seriesName.trim() ? seriesName : undefined,
          variant: Number(variant) || 1,
        });

        const res = await fetch("/api/campaigns/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            asin: normalizedAsin,
            campaignName,
            marketplace,
            authorName,
            bookTitle,
            seriesName: seriesName || null,
            seriesOrder: seriesOrder ? parseInt(seriesOrder) : null,
            seriesTotal: seriesTotal ? parseInt(seriesTotal) : null,
            variant: Number(variant) || 1,
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          setErrorMessage(errBody.error ?? `Request failed (${res.status}).`);
          setStatus("error");
          return;
        }
      }

      setStatus("success");
      setErrorMessage(null);

      // Redirect back to dashboard after 1.5 seconds
      setTimeout(() => {
        onBack();
      }, 1500);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const isLoading = status === "loading";

  // Simplified form for book-centric flow
  if (bookId) {
    return (
      <main className="flex-1 flex justify-center px-3 py-6 md:px-6 md:py-10">
        <div className="w-full max-w-2xl shell p-4 md:p-8">
          <div className="flex items-center justify-between gap-4 mb-8">
            <div className="flex items-center gap-3">
              <button
                onClick={onBack}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} className="text-gray-600" />
              </button>
              <div className="logo-mark">PB</div>
              <div>
                <p className="brand-title text-base md:text-lg">New Campaign</p>
                <p className="eyebrow">Create campaign for this book</p>
              </div>
            </div>
          </div>

          <div className="mb-6 md:mb-8">
            <h1 className="page-heading text-2xl md:text-4xl">Create Campaign</h1>
            <p className="text-sm mt-3 max-w-2xl leading-relaxed" style={{ color: "var(--muted)" }}>
              Give your new campaign a name and variant number. You can configure keywords and budget later.
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="card mb-6">
              <p className="card-title mb-4">Campaign Details</p>
              <div className="space-y-4">
                <div>
                  <label className="field-label">Campaign Name</label>
                  <input
                    required
                    value={variant}
                    onChange={(e) => setVariant(e.target.value)}
                    placeholder="Campaign Variant (e.g., 1, 2, A, etc.)"
                    className="input"
                  />
                  <span className="field-hint">
                    Enter a variant identifier for this campaign
                  </span>
                </div>
              </div>
            </div>

            {status === "error" && errorMessage && (
              <div
                className="mb-6 status-banner"
                style={{ background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }}
              >
                <span className="status-dot" style={{ background: "var(--accent-red)" }} />
                <span style={{ color: "var(--accent-red)" }}>{errorMessage}</span>
              </div>
            )}

            {status === "success" && (
              <div
                className="mb-6 status-banner"
                style={{ background: "var(--accent-green-soft)", borderColor: "var(--accent-green)" }}
              >
                <span className="status-dot" style={{ background: "var(--accent-green)" }} />
                <span style={{ color: "var(--accent-green)" }}>Campaign created! Redirecting...</span>
              </div>
            )}

            <div className="flex gap-3 justify-between">
              <button
                type="button"
                onClick={onBack}
                className="btn-pill-outline px-6 py-2.5"
              >
                ← Cancel
              </button>

              <button
                type="submit"
                disabled={isLoading || !variant}
                className="btn-pill-dark px-6 py-2.5"
              >
                {isLoading ? "Creating…" : "Create Campaign"}
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  const [recommendedMin] = recommendedRange?.split("-").map(Number) ?? [null];
  const belowRecommendedMin =
    tropesKeywordCount !== null && recommendedMin !== null && tropesKeywordCount < recommendedMin;

  return (
    <>
      <main className="flex-1 flex justify-center px-3 py-6 md:px-6 md:py-10">
        <div className="w-full max-w-6xl shell p-4 md:p-8">
        {/* Topbar */}
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Back to campaigns"
            >
              <ArrowLeft size={20} className="text-gray-600" />
            </button>
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
          {/* Progress Stepper - Hidden for simplified flow */}

          <div className="min-h-96">
            {/* Simplified flow - only show first page for campaign creation */}
              <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-5 md:gap-6 items-start">
                <div className="flex flex-col gap-5 md:gap-6">
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-2">
                    <p className="text-sm font-semibold text-gray-900 mb-2">📖 Quick Start</p>
                    <p className="text-xs text-gray-600 leading-relaxed">
                      Have an ASIN or ISBN? Click "Autofill" to automatically populate book details from Amazon.
                    </p>
                  </div>

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

                  {(profileCoverImageUrl ||
                    profileCategoryPath.length > 0 ||
                    profileBestSellerRanks.length > 0 ||
                    profileDescription ||
                    profileTags.length > 0 ||
                    profileBulletPoints.length > 0 ||
                    profileCompTitles.length > 0 ||
                    profileCompDetails.length > 0) && (
                    <div className="card">
                      <div className="flex items-center justify-between mb-4">
                        <p className="card-title mb-0">Book Metadata</p>
                    <button
                      type="button"
                      onClick={() => setExpandedMetadata(!expandedMetadata)}
                      className="text-xs btn-pill-outline"
                      style={{ padding: "0.35rem 0.75rem", fontSize: "0.75rem" }}
                    >
                        {expandedMetadata ? "Collapse" : "Expand"}
                        </button>
                      </div>

                      {profileCoverImageUrl && (
                        <div className="mb-4 pb-4 border-b border-line">
                          <img
                            src={profileCoverImageUrl}
                            alt="Book cover"
                            className="w-full max-w-xs rounded-md"
                            style={{ maxHeight: "200px", objectFit: "cover" }}
                          />
                        </div>
                      )}

                      <div className="space-y-3">
                        {/* Core metadata always shown */}
                    {profileCategoryPath.length > 0 && (
                      <>
                        {profileCategoryPath.length > 1 && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Genre: </span>
                            {profileCategoryPath[1] || "—"}
                          </p>
                        )}
                        {profileCategoryPath.length > 2 && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Subgenres: </span>
                            {profileCategoryPath.slice(2).join(" › ")}
                          </p>
                        )}
                      </>
                    )}

                    {profileBestSellerRanks.length > 0 && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Best Sellers Rank: </span>
                        {profileBestSellerRanks
                          .slice(0, 2)
                          .map((r) => `#${r.rank.toLocaleString()} in ${r.category}`)
                          .join(", ")}
                        {profileBestSellerRanks.length > 2 && ` (+${profileBestSellerRanks.length - 2} more)`}
                      </p>
                    )}

                    {profilePrice && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>List Price: </span>
                        ${profilePrice.toFixed(2)}
                      </p>
                    )}

                    {profileRating && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Rating: </span>
                        ⭐ {profileRating.toFixed(1)}/5
                        {profileReviewCount && ` (${profileReviewCount.toLocaleString()} reviews)`}
                      </p>
                    )}

                    {profileQaCount && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Customer Q&A: </span>
                        {profileQaCount.toLocaleString()} questions
                      </p>
                    )}

                    {profileAvailability && (
                      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                        <span className="font-semibold" style={{ color: "var(--ink)" }}>Availability: </span>
                        {profileAvailability}
                      </p>
                    )}

                    {/* Expanded metadata */}
                    {expandedMetadata && (
                      <>
                        {profileIsbn10 && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>ISBN-10: </span>
                            {profileIsbn10}
                          </p>
                        )}
                        {profileIsbn13 && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>ISBN-13: </span>
                            {profileIsbn13}
                          </p>
                        )}

                        {profilePublisher && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Publisher: </span>
                            {profilePublisher}
                          </p>
                        )}

                        {profilePublicationDate && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Published: </span>
                            {profilePublicationDate}
                          </p>
                        )}

                        {profilePageCount && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Pages: </span>
                            {profilePageCount.toLocaleString()}
                          </p>
                        )}

                        {profileLanguage && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Language: </span>
                            {profileLanguage}
                          </p>
                        )}

                        {profileDimensions && (
                          <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Dimensions: </span>
                            {profileDimensions}
                          </p>
                        )}

                        {profileCompDetails.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Customers Also Bought (Detailed):</span>
                            <div className="mt-2 space-y-2">
                              {profileCompDetails.slice(0, 5).map((comp) => (
                                <div key={comp.asin} className="p-2 rounded" style={{ background: "var(--surface-soft)" }}>
                                  <p className="text-xs font-medium truncate">{comp.title}</p>
                                  {comp.author && <p className="text-xs" style={{ color: "var(--muted)" }}>by {comp.author}</p>}
                                  <div className="flex gap-2 mt-1 text-xs">
                                    {comp.rating && <span>⭐ {comp.rating.toFixed(1)}</span>}
                                    {comp.reviewCount && <span>{comp.reviewCount.toLocaleString()} reviews</span>}
                                  </div>
                                </div>
                              ))}
                              {profileCompDetails.length > 5 && (
                                <p className="text-xs" style={{ color: "var(--accent-purple)" }}>
                                  +{profileCompDetails.length - 5} more competitors
                                </p>
                              )}
                            </div>
                          </div>
                        )}

                        {profileCompTitles.length > 0 && profileCompDetails.length === 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Customers Also Bought:</span>
                            <ul className="list-disc list-inside mt-1 ml-1 space-y-0.5">
                              {profileCompTitles.map((title) => (
                                <li key={title} className="text-xs">
                                  {title}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {profileBulletPoints.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Description Bullets:</span>
                            <ul className="list-disc list-inside mt-1 ml-1 space-y-0.5">
                              {profileBulletPoints.slice(0, 3).map((bullet) => (
                                <li key={bullet} className="text-xs truncate" title={bullet}>
                                  {bullet.length > 60 ? bullet.slice(0, 60) + "…" : bullet}
                                </li>
                              ))}
                              {profileBulletPoints.length > 3 && (
                                <li className="text-xs" style={{ color: "var(--accent-purple)" }}>
                                  +{profileBulletPoints.length - 3} more
                                </li>
                              )}
                            </ul>
                          </div>
                        )}

                        {profileDescription && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Description:</span>
                            <p className="mt-1 line-clamp-2" style={{ fontSize: "0.7rem", lineHeight: "1.4" }}>
                              {profileDescription}
                            </p>
                          </div>
                        )}

                        {profileGoogleBooksCategories.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Google Books Categories:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileGoogleBooksCategories.slice(0, 4).map((cat) => (
                                <span key={cat} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {cat}
                                </span>
                              ))}
                              {profileGoogleBooksCategories.length > 4 && (
                                <span
                                  className="chip-tag"
                                  style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}
                                >
                                  +{profileGoogleBooksCategories.length - 4}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileOpenLibrarySubjects.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Open Library Subjects:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileOpenLibrarySubjects.slice(0, 4).map((subj) => (
                                <span key={subj} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {subj}
                                </span>
                              ))}
                              {profileOpenLibrarySubjects.length > 4 && (
                                <span
                                  className="chip-tag"
                                  style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}
                                >
                                  +{profileOpenLibrarySubjects.length - 4}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileGoodreadsTags.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Goodreads Tags:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileGoodreadsTags.slice(0, 6).map((tag) => (
                                <span key={tag} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {tag}
                                </span>
                              ))}
                              {profileGoodreadsTags.length > 6 && (
                                <span
                                  className="chip-tag"
                                  style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}
                                >
                                  +{profileGoodreadsTags.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileFirecrawlCategories.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Firecrawl Categories:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileFirecrawlCategories.slice(0, 8).map((cat) => (
                                <span key={cat} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {cat}
                                </span>
                              ))}
                              {profileFirecrawlCategories.length > 8 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileFirecrawlCategories.length - 8}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileFirecrawlFeatures.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Firecrawl Features:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileFirecrawlFeatures.slice(0, 6).map((feat) => (
                                <span key={feat} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {feat}
                                </span>
                              ))}
                              {profileFirecrawlFeatures.length > 6 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileFirecrawlFeatures.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileFirecrawlKeywords.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Firecrawl Keywords:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileFirecrawlKeywords.slice(0, 6).map((kw) => (
                                <span key={kw} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {kw}
                                </span>
                              ))}
                              {profileFirecrawlKeywords.length > 6 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileFirecrawlKeywords.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileWikipediaCategories.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Wikipedia Categories:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileWikipediaCategories.slice(0, 6).map((cat) => (
                                <span key={cat} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {cat}
                                </span>
                              ))}
                              {profileWikipediaCategories.length > 6 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileWikipediaCategories.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileWikidataGenres.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Wikidata Genres:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileWikidataGenres.slice(0, 6).map((genre) => (
                                <span key={genre} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {genre}
                                </span>
                              ))}
                              {profileWikidataGenres.length > 6 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileWikidataGenres.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileLocSubjects.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Library of Congress Subjects:</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {profileLocSubjects.slice(0, 6).map((subj) => (
                                <span key={subj} className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                  {subj}
                                </span>
                              ))}
                              {profileLocSubjects.length > 6 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileLocSubjects.length - 6}
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileFrequentlyBoughtTogether.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Frequently Bought Together:</span>
                            <div className="flex flex-col gap-1 mt-1">
                              {profileFrequentlyBoughtTogether.slice(0, 5).map((item) => (
                                <div key={item.asin} className="text-xs">
                                  <span className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                    {item.title.substring(0, 50)}
                                  </span>
                                  <span style={{ fontSize: "0.65rem", marginLeft: "0.5rem" }}>({item.asin})</span>
                                </div>
                              ))}
                              {profileFrequentlyBoughtTogether.length > 5 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileFrequentlyBoughtTogether.length - 5} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}

                        {profileCompareWithSimilar.length > 0 && (
                          <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                            <span className="font-semibold" style={{ color: "var(--ink)" }}>Compare with Similar Items:</span>
                            <div className="flex flex-col gap-1 mt-1">
                              {profileCompareWithSimilar.slice(0, 5).map((item) => (
                                <div key={item.asin} className="text-xs">
                                  <span className="chip-tag" style={{ fontSize: "0.7rem" }}>
                                    {item.title.substring(0, 50)}
                                  </span>
                                  <span style={{ fontSize: "0.65rem", marginLeft: "0.5rem" }}>({item.asin})</span>
                                </div>
                              ))}
                              {profileCompareWithSimilar.length > 5 && (
                                <span className="chip-tag" style={{ fontSize: "0.7rem", color: "var(--accent-purple)" }}>
                                  +{profileCompareWithSimilar.length - 5} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </>
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
                    <span className="field-hint">
                      Full series name for metadata and targeting
                    </span>
                  </Field>

                  {seriesName && (
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Series Book #">
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={seriesOrder}
                          onChange={(e) => setSeriesOrder(e.target.value)}
                          placeholder="5"
                          className="input"
                        />
                        <span className="field-hint">
                          This book's position in series (e.g., Book 5 of X)
                        </span>
                      </Field>
                      <Field label="Series Total (optional)">
                        <input
                          type="number"
                          min="1"
                          max="999"
                          value={seriesTotal}
                          onChange={(e) => setSeriesTotal(e.target.value)}
                          placeholder="12"
                          className="input"
                        />
                        <span className="field-hint">
                          Total books in series if known
                        </span>
                      </Field>
                    </div>
                  )}

                  {previewName && (
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      Campaign name:{" "}
                      <code className="chip-tag" style={{ cursor: "default" }}>{previewName}</code>
                    </p>
                  )}
                </div>
              </div>
            </div>
            </div>

            {/* Pages 2-6 hidden in simplified flow */}
            {false && (<>
            {currentPage === 2 && (
            <div className="flex flex-col gap-5 md:gap-6 max-w-2xl">
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

                  <Field label="Campaign Duration">
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <label className="option-card">
                          <input
                            type="radio"
                            className="mt-0.5"
                            checked={campaignDuration === "ongoing"}
                            onChange={() => setCampaignDuration("ongoing")}
                          />
                          <span>
                            Ongoing
                            <span
                              className="block text-xs font-normal mt-0.5"
                              style={{ color: "var(--muted)" }}
                            >
                              No end date — campaign runs indefinitely
                            </span>
                          </span>
                        </label>
                        <label className="option-card">
                          <input
                            type="radio"
                            className="mt-0.5"
                            checked={campaignDuration === "limited"}
                            onChange={() => setCampaignDuration("limited")}
                          />
                          <span>
                            Limited Duration
                            <span
                              className="block text-xs font-normal mt-0.5"
                              style={{ color: "var(--muted)" }}
                            >
                              Set an end date for this campaign
                            </span>
                          </span>
                        </label>
                      </div>
                      {campaignDuration === "limited" && (
                        <Field label="End Date">
                          <input
                            required
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            min={startDate}
                            className="input"
                          />
                          <span className="field-hint">
                            {endDate && startDate ? `${Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))} days` : "Campaign duration"}
                          </span>
                        </Field>
                      )}
                    </div>
                  </Field>

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

              <div className="card bg-gray-50 border-gray-200">
                <p className="card-title mb-3 text-gray-900">Budget Calculator</p>
                <p className="field-hint mb-4 text-gray-600" style={{ marginTop: 0 }}>
                  Estimate based on 50% daily utilization (not all keywords get clicks daily).
                </p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 bg-white rounded border border-gray-200">
                    <div>
                      <p className="text-xs text-gray-600 font-medium">Estimated Daily Spend</p>
                      <p className="text-2xl font-bold text-gray-900">${(Number(dailyBudget) * 0.5).toFixed(2)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-600 font-medium">Strategy Impact</p>
                      <p className="text-lg font-semibold text-gray-900">{matchTypeStrategy === "phrase-only" ? "1x" : matchTypeStrategy === "phrase-exact" ? "2x" : matchTypeStrategy === "custom" ? "Varies" : "3x"}</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">
                    💡 Tip: Phrase-only strategy costs 1/3 as much and works well for niche books.
                  </p>
                </div>
              </div>
            </div>
            )}

            {currentPage === 3 && (
            <div className="flex flex-col gap-5 md:gap-6 max-w-4xl">
              <div className="card">
                <p className="card-title mb-4">Keyword Types</p>
                <p className="field-hint mb-3" style={{ marginTop: 0 }}>
                  Which ad groups to build into the Bulksheet. All three are selected by
                  default; deselecting one skips it entirely rather than leaving it empty.
                </p>
                <div className="flex flex-col gap-2">
                  {KEYWORD_TYPES.map(({ value, label, hint }) => (
                    <label key={value} className="option-card">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={selectedKeywordTypes.includes(value)}
                        onChange={() => toggleKeywordType(value)}
                      />
                      <span>
                        {label}
                        <span className="block text-xs font-normal mt-0.5" style={{ color: "var(--muted)" }}>
                          {hint}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
                {selectedKeywordTypes.length === 0 && (
                  <p className="field-hint" style={{ color: "var(--accent-red)" }}>
                    Select at least one keyword type.
                  </p>
                )}
              </div>

              <div className="card">
                <p className="card-title mb-4">Keyword Sources</p>
                <p className="field-hint mb-3" style={{ marginTop: 0 }}>
                  Which free sources to fold into the candidate pool. All are on by default —
                  deselect any you don&apos;t want contributing keywords this run.
                </p>
                <div className="flex flex-wrap gap-2">
                  {KEYWORD_SOURCES.map(({ value, label }) => (
                    <label key={value} className="chip-toggle">
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(value)}
                        onChange={() => toggleSource(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            )}

            {currentPage === 4 && (
            <div className="flex flex-col gap-5 md:gap-6 max-w-4xl">
              <div className="card">
                <p className="card-title mb-4">Match-Type Strategy (Phase 2.1)</p>
                <p className="field-hint mb-4" style={{ marginTop: 0 }}>
                  Choose a strategy that balances keyword coverage vs. budget impact. Phrase-only is more conservative and costs 1/3 as much.
                </p>
                <div className="flex flex-col gap-3">
                  {(Object.entries(MATCH_TYPE_STRATEGIES) as Array<[MatchTypeStrategy, typeof MATCH_TYPE_STRATEGIES[MatchTypeStrategy]]>).map(
                    ([value, config]) => (
                      <label key={value} className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                        <input
                          type="radio"
                          name="matchTypeStrategy"
                          value={value}
                          checked={matchTypeStrategy === value}
                          onChange={() => setStrategy(value)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-gray-900">{config.label}</p>
                          <p className="text-sm text-gray-600 mt-1">{config.description}</p>
                          <p className="text-xs text-gray-500 mt-2">{config.matchTypes.join(" + ")}</p>
                        </div>
                      </label>
                    )
                  )}
                  <label className="flex items-start gap-3 p-3 border border-gray-200 rounded cursor-pointer hover:bg-gray-50">
                    <input
                      type="radio"
                      name="matchTypeStrategy"
                      checked={matchTypeStrategy === "custom"}
                      onChange={() => setMatchTypeStrategy("custom")}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">Custom</p>
                      <p className="text-sm text-gray-600 mt-1">Choose your own combination below</p>
                    </div>
                  </label>
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

              <div className="card">
                <p className="card-title mb-4">Keyword Categories</p>
                <p className="field-hint mb-3" style={{ marginTop: 0 }}>
                  20-category semantic taxonomy describing what kind of keyword each is
                  (genre, trope, mood, gift-intent, etc.). All are enabled by default;
                  deselect categories you don&apos;t want generating candidates.
                </p>
                <div className="flex flex-wrap gap-2">
                  {KEYWORD_CATEGORY_META.map(({ value, label }) => (
                    <label key={value} className="chip-toggle">
                      <input
                        type="checkbox"
                        checked={selectedKeywordCategories.includes(value)}
                        onChange={() => toggleKeywordCategory(value)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="card border-gray-200 bg-gray-50">
                <p className="card-title mb-4 text-gray-900">Budget Capping Preview (Phase 2.2)</p>
                <p className="field-hint mb-4 text-gray-600" style={{ marginTop: 0 }}>
                  We'll automatically cap keywords to fit your budget. Here's the estimated max based on your current settings:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  <div className="bg-white rounded p-3 border border-gray-200">
                    <p className="text-xs text-gray-600 font-medium">Daily Budget</p>
                    <p className="text-lg font-bold text-gray-900">${dailyBudget}</p>
                  </div>
                  <div className="bg-white rounded p-3 border border-gray-200">
                    <p className="text-xs text-gray-600 font-medium">Strategy</p>
                    <p className="text-sm font-semibold text-gray-900 capitalize">
                      {matchTypeStrategy === "phrase-only" ? "Phrase Only (1x)" : matchTypeStrategy === "phrase-exact" ? "Phrase + Exact (2x)" : matchTypeStrategy === "custom" ? "Custom" : "All Types (3x)"}
                    </p>
                  </div>
                  <div className="bg-white rounded p-3 border border-gray-200">
                    <p className="text-xs text-gray-600 font-medium">Est. Max Keywords</p>
                    <p className="text-lg font-bold text-gray-900">
                      ~{Math.floor((Number(dailyBudget) * 0.5) / (0.15 * (matchTypeStrategy === "phrase-only" ? 1 : matchTypeStrategy === "phrase-exact" ? 2 : 3)))}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-gray-600 mt-3">
                  💡 Assumes $0.15 avg CPC and 50% daily utilization. Actual cap depends on your bid economics.
                </p>
              </div>
            </div>
            )}

            {currentPage === 5 && (
            <div className="flex flex-col gap-5 md:gap-6 max-w-4xl">
              <div className="card">
                <p className="card-title mb-4">Key Tropes & Themes (optional)</p>
                <p className="field-hint mb-3" style={{ marginTop: 0 }}>
                  Main character archetypes, relationship dynamics, plot devices, or settings
                  in your book (e.g., &quot;grumpy billionaire&quot;, &quot;enemies to lovers&quot;). These are high-trust
                  signals the app can&apos;t reliably scrape, so you supply them directly to seed
                  character/relationship/plot/setting category generation.
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {keyTropes.map((trope) => (
                    <button
                      key={trope}
                      type="button"
                      onClick={() => removeKeyTrope(trope)}
                      title="Remove trope"
                      className="chip-tag"
                    >
                      {trope} ×
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={keyTropesInput}
                    onChange={(e) => setKeyTropesInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addKeyTrope();
                      }
                    }}
                    placeholder="e.g., grumpy billionaire, slow burn romance"
                    className="input"
                  />
                  <button type="button" onClick={addKeyTrope} className="btn-pill-outline shrink-0">
                    Add
                  </button>
                </div>
              </div>

              <div className="card">
                <p className="card-title mb-4">Add Keywords</p>
                <p className="field-hint mb-3" style={{ marginTop: 0 }}>
                  Search for and add keywords yourself — added terms are guaranteed a slot
                  in Tropes &amp; Themes, ranked above generated candidates. Bare ASINs are
                  routed to Product Targeting instead.
                </p>
                <div className="flex flex-wrap gap-1.5 mb-3">
                  {manualKeywords.map((keyword) => (
                    <button
                      key={keyword}
                      type="button"
                      onClick={() => removeManualKeyword(keyword)}
                      title="Remove keyword"
                      className="chip-tag"
                    >
                      {keyword} ×
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    value={manualKeywordInput}
                    onChange={(e) => setManualKeywordInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addManualKeyword();
                      }
                    }}
                    placeholder="Search for a keyword to add"
                    className="input"
                  />
                  <button type="button" onClick={addManualKeyword} className="btn-pill-outline shrink-0">
                    Add
                  </button>
                </div>
              </div>

            </div>
            )}

            {currentPage === 6 && (
            <div className="flex flex-col gap-5 md:gap-6 max-w-3xl">
              <div className="card">
                <p className="card-title mb-4">Campaign Summary</p>
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Book</p>
                      <p className="text-sm font-semibold">{bookTitle || "—"}</p>
                      <p className="text-xs" style={{ color: "var(--muted)" }}>{authorName || "—"}</p>
                    </div>
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>ASIN / ISBN</p>
                      <p className="text-sm font-mono">{asin || "—"}</p>
                    </div>
                    {seriesName && (
                      <div>
                        <p className="field-hint mb-2" style={{ marginTop: 0 }}>Series</p>
                        <p className="text-sm font-semibold">{seriesName}</p>
                        {seriesOrder && (
                          <p className="text-xs" style={{ color: "var(--muted)" }}>Book {seriesOrder}{seriesTotal ? ` of ${seriesTotal}` : ""}</p>
                        )}
                      </div>
                    )}
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Marketplace</p>
                      <p className="text-sm">{marketplace}</p>
                    </div>
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Daily Budget</p>
                      <p className="text-sm">${dailyBudget}</p>
                    </div>
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Campaign Start</p>
                      <p className="text-sm">{startDate}</p>
                    </div>
                    {(campaignDuration === "limited" && endDate) && (
                      <div>
                        <p className="field-hint mb-2" style={{ marginTop: 0 }}>Campaign End</p>
                        <p className="text-sm">{endDate}</p>
                      </div>
                    )}
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Duration</p>
                      <p className="text-sm capitalize">
                        {campaignDuration === "ongoing" ? "Ongoing" : (endDate ? `${Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))} days` : "—")}
                      </p>
                    </div>
                    <div>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Match Types</p>
                      <p className="text-sm capitalize">{matchTypes.join(", ")}</p>
                    </div>
                  </div>

                  <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
                    <p className="field-hint mb-3" style={{ marginTop: 0 }}>Keyword Configuration</p>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <span style={{ color: "var(--muted)" }}>Keyword Types: </span>
                        <span className="font-semibold">{selectedKeywordTypes.length}/3 selected</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>Sources: </span>
                        <span className="font-semibold">{selectedSources.length}/{KEYWORD_SOURCES.length} enabled</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>Categories: </span>
                        <span className="font-semibold">{selectedKeywordCategories.length}/{KEYWORD_CATEGORY_META.length} active</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>Manual Keywords: </span>
                        <span className="font-semibold">{manualKeywords.length} added</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>Key Tropes: </span>
                        <span className="font-semibold">{keyTropes.length} added</span>
                      </div>
                      <div>
                        <span style={{ color: "var(--muted)" }}>Bidding: </span>
                        <span className="font-semibold">{useRrpBidding ? "RRP-based" : "Manual"}</span>
                      </div>
                    </div>
                  </div>

                  {previewName && (
                    <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
                      <p className="field-hint mb-2" style={{ marginTop: 0 }}>Campaign Name</p>
                      <code className="chip-tag" style={{ cursor: "default", fontSize: "0.85rem" }}>
                        {previewName}
                      </code>
                    </div>
                  )}

                  <div className="border-t pt-4" style={{ borderColor: "var(--line)" }}>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      Ready to generate your bulksheet? Click the button below to proceed.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-5 max-w-3xl">
                <p className="font-semibold text-gray-900 mb-3">✨ What Happens Next</p>
                <ol className="space-y-2 text-sm text-gray-700">
                  <li className="flex gap-3">
                    <span className="font-semibold text-gray-600 shrink-0">1.</span>
                    <span>We generate keywords from {selectedSources.length} sources and organize them into {selectedKeywordTypes.length} ad groups</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-gray-600 shrink-0">2.</span>
                    <span>Apply {matchTypeStrategy === "phrase-only" ? "phrase-only" : matchTypeStrategy === "phrase-exact" ? "phrase + exact" : matchTypeStrategy === "custom" ? "custom" : "all three"} match types for {matchTypeStrategy === "phrase-only" ? "lower cost and focused reach" : matchTypeStrategy === "phrase-exact" ? "balanced coverage" : "maximum coverage"}</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-gray-600 shrink-0">3.</span>
                    <span>Cap keywords to fit your ${dailyBudget}/day budget using Phase 2.2 budget-aware logic</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-gray-600 shrink-0">4.</span>
                    <span>Send bulksheet Excel file to your email + provide download link (expires in 1 hour)</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-semibold text-gray-600 shrink-0">5.</span>
                    <span>Upload to Amazon Ads using their bulk upload tool — campaigns are immediately live!</span>
                  </li>
                </ol>
              </div>
            </div>
            )}
            </>
            )}
          </div>

          {/* Navigation - Simplified to only save campaign basics */}
          <div className="flex gap-3 mt-8 justify-between">
            <button
              type="button"
              onClick={onBack}
              className="btn-pill-outline px-6 py-2.5"
            >
              ← Cancel
            </button>

            <button
              type="submit"
              disabled={isLoading || !asin || !authorName || !bookTitle}
              className="btn-pill-dark px-6 py-2.5"
            >
              {isLoading ? "Saving…" : "Save Campaign"}
            </button>
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
                Bulksheet sent to your email
                {resultCampaignName ? ` — ${resultCampaignName}` : ""}.{" "}
                {recommendedRange ? `Amazon recommends ${recommendedRange} keywords per ad group. ` : ""}
                {aiRankingUsed
                  ? "AI-ranked (Gemini)."
                  : "Heuristic-ranked (set GEMINI_API_KEY to enable AI ranking)."}
                {belowRecommendedMin &&
                  " Tropes & Themes is below Amazon's recommended minimum — free sources came up short for this ASIN; consider adding a few keywords manually before uploading."}
              </span>
            </div>

            {archiveUrl && (
              <p className="text-sm" style={{ color: "var(--muted)" }}>
                A copy was saved to cloud storage.{" "}
                <a
                  href={archiveUrl}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--accent-green)", textDecoration: "underline" }}
                >
                  Download now
                </a>{" "}
                — link expires in 1 hour.
              </p>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="stat-tile tone-purple">
                <span className="stat-value">{tropesKeywordCount ?? 0}</span>
                <span className="stat-label">Tropes</span>
              </div>
              <div className="stat-tile tone-green">
                <span className="stat-value">{compNameKeywordCount ?? 0}</span>
                <span className="stat-label">Comp Authors</span>
              </div>
              <div className="stat-tile tone-yellow">
                <span className="stat-value">{productTargetCount ?? 0}</span>
                <span className="stat-label">Product Targets</span>
              </div>
              <div className="stat-tile tone-blue">
                <span className="stat-value">{manualKeywordCount ?? 0}</span>
                <span className="stat-label">Manual</span>
              </div>
              <div className="stat-tile tone-indigo">
                <span className="stat-value">{((tropesKeywordCount ?? 0) + (compNameKeywordCount ?? 0) + (productTargetCount ?? 0)) * (matchTypeStrategy === "phrase-only" ? 1 : matchTypeStrategy === "phrase-exact" ? 2 : 3)}</span>
                <span className="stat-label">Total Rows</span>
              </div>
              <div className="stat-tile tone-purple">
                <span className="stat-value">{aiRankingUsed ? "AI" : "Heuristic"}</span>
                <span className="stat-label">Ranked By</span>
              </div>
            </div>

            <div className="card border-gray-200 bg-gray-50">
              <p className="card-title mb-4 text-gray-900">Budget Summary</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-gray-600 font-medium mb-1">Daily Budget</p>
                  <p className="text-xl font-bold text-gray-900">${dailyBudget}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium mb-1">Match Strategy</p>
                  <p className="text-sm font-semibold text-gray-900 capitalize">{matchTypeStrategy === "phrase-only" ? "Phrase Only (1x)" : matchTypeStrategy === "phrase-exact" ? "Phrase + Exact (2x)" : matchTypeStrategy === "custom" ? "Custom" : "All Types (3x)"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-medium mb-1">Estimated Spend</p>
                  <p className="text-xl font-bold text-gray-900">${(Number(dailyBudget) * 0.5).toFixed(2)}</p>
                  <p className="text-xs text-gray-600">(50% utilization)</p>
                </div>
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
    </>
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
