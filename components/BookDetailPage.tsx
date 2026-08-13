"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import BookActionBar from "./BookActionBar";
import CampaignActions from "./CampaignActions";
import KeywordManager from "./KeywordManager";

/** The slice of the stored snapshot (books.metadata_json) this page renders. */
export interface BookSnapshotView {
  version?: number;
  capturedAt?: string;
  title?: string;
  author?: string;
  description?: string;
  seriesName?: string;
  publisher?: string;
  publicationDate?: string;
  pageCount?: number;
  language?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  coverImageUrl?: string;
  categoryPath?: string[];
  bestSellerRanks?: Array<{ rank: number; category: string }>;
  genreTerms?: string[];
  competitors?: Array<{ asin: string; title?: string; author?: string }>;
  compTitles?: string[];
  reviewSnippets?: string[];
  reviewBodies?: string[];
  compReviewSnippets?: string[];
  qnaQuestions?: string[];
  goodreadsTags?: string[];
  openLibrarySubjects?: string[];
  googleBooksCategories?: string[];
  /** Editions confirmed on the listing — format keywords are only allowed for these. */
  formats?: string[];
  isKindleUnlimited?: boolean;
  capture?: {
    ok: boolean;
    blocked: boolean;
    emptySources?: string[];
    /** Share of the tracked ListingRecord fields this capture found, 0-1. */
    completeness?: number;
  };
}

export interface Book {
  id: string;
  asin: string;
  title: string;
  author: string;
  marketplace: string;
  description?: string | null;
  total_keywords: number;
  created_at: string;
  metadata_json?: BookSnapshotView | null;
  /** §21: "mixed" (default Broad/Phrase/Exact) or "phrase-only". */
  match_type_profile?: "mixed" | "phrase-only";
}

interface BookDetailPageProps {
  bookId: string;
  onBack: () => void;
}

function formatDate(value: string | undefined): string {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "unknown"
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Fetches without touching state, so effects never set state synchronously. */
async function fetchBook(bookId: string): Promise<Book | null> {
  try {
    const res = await fetch(`/api/books/${bookId}`);
    const body = await res.json().catch(() => ({}));
    return res.ok ? (body.book as Book) : null;
  } catch {
    return null;
  }
}

export default function BookDetailPage({ bookId, onBack }: BookDetailPageProps) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped after a shared action (generate/filter/presets) to force the
  // keyword and competitor managers to refetch — simpler than threading a
  // second imperative refresh path through each of them.
  const [dataKey, setDataKey] = useState(0);
  // The manual add-keyword/add-ASIN inputs only render as a popup, opened via BookActionBar's "Manual" button.
  const [showManualAdd, setShowManualAdd] = useState(false);

  useEffect(() => {
    let active = true;
    fetchBook(bookId).then((loaded) => {
      if (!active) return;
      setBook(loaded);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [bookId]);

  // Keeps the header's keyword count in step with edits made below it.
  const reloadBook = useCallback(async () => {
    const loaded = await fetchBook(bookId);
    if (loaded) setBook(loaded);
  }, [bookId]);

  async function updateMatchTypeProfile(profile: "mixed" | "phrase-only") {
    if (!book) return;
    const previous = book.match_type_profile ?? "mixed";
    setBook({ ...book, match_type_profile: profile });
    const res = await fetch(`/api/books/${bookId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matchTypeProfile: profile }),
    });
    if (!res.ok) setBook((current) => (current ? { ...current, match_type_profile: previous } : current));
  }

  function onDataChanged() {
    setDataKey((k) => k + 1);
    void reloadBook();
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <header className="page-header">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton mt-4 h-8 w-64" />
        </header>
        <div className="page-body space-y-6" aria-busy="true" aria-label="Loading book">
          <div className="card space-y-4">
            <div className="skeleton h-4 w-48" />
            <div className="skeleton h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="flex min-h-screen flex-col bg-white">
        <header className="page-header">
          <button onClick={onBack} className="btn-link">
            <ArrowLeft size={20} />
            Back to books
          </button>
        </header>
        <div className="page-body flex-1">
          <div className="empty-state">
            <span className="icon-tile icon-tile-lg">
              <AlertTriangle size={24} style={{ color: "var(--icon-default)" }} />
            </span>
            <div className="space-y-1">
              <p className="empty-state-title">Book not found</p>
              <p className="empty-state-body">
                It may have been deleted, or it belongs to another account.
              </p>
            </div>
            <button onClick={onBack} className="btn btn-secondary">
              Back to books
            </button>
          </div>
        </div>
      </div>
    );
  }

  const snapshot = book.metadata_json ?? {};
  const captureFailed = snapshot.capture ? !snapshot.capture.ok || snapshot.capture.blocked : true;
  const genreTerms = snapshot.genreTerms ?? [];
  const mineable =
    (snapshot.competitors?.length ?? 0) +
    (snapshot.compTitles?.length ?? 0) +
    (snapshot.reviewSnippets?.length ?? 0) +
    (snapshot.reviewBodies?.length ?? 0) +
    (snapshot.compReviewSnippets?.length ?? 0) +
    (snapshot.qnaQuestions?.length ?? 0) +
    (snapshot.goodreadsTags?.length ?? 0) +
    (snapshot.openLibrarySubjects?.length ?? 0) +
    (snapshot.googleBooksCategories?.length ?? 0);

  const facts: Array<[string, string]> = [
    ["ASIN", book.asin],
    ["Marketplace", book.marketplace],
    ...(snapshot.seriesName ? ([["Series", snapshot.seriesName]] as Array<[string, string]>) : []),
    ...(snapshot.publisher ? ([["Publisher", snapshot.publisher]] as Array<[string, string]>) : []),
    ...(snapshot.publicationDate ? ([["Published", snapshot.publicationDate]] as Array<[string, string]>) : []),
    ...(snapshot.pageCount ? ([["Pages", String(snapshot.pageCount)]] as Array<[string, string]>) : []),
    ...(snapshot.price !== undefined ? ([["Price", snapshot.price.toFixed(2)]] as Array<[string, string]>) : []),
    ...(snapshot.rating !== undefined
      ? ([["Rating", `${snapshot.rating} (${snapshot.reviewCount ?? 0} reviews)`]] as Array<[string, string]>)
      : []),
    ...(snapshot.formats?.length
      ? ([
          [
            "Formats",
            snapshot.formats.map((f) => f.charAt(0).toUpperCase() + f.slice(1)).join(", ") +
              (snapshot.isKindleUnlimited ? " · Kindle Unlimited" : ""),
          ],
        ] as Array<[string, string]>)
      : []),
    ...(snapshot.bestSellerRanks?.length
      ? ([["Best seller rank", `#${snapshot.bestSellerRanks[0].rank} in ${snapshot.bestSellerRanks[0].category}`]] as Array<
          [string, string]
        >)
      : []),
  ];

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="page-header">
        <button onClick={onBack} className="btn-link mb-4">
          <ArrowLeft size={20} />
          Back to books
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="page-title">{book.title}</h1>
            <p className="page-subtitle mt-1">
              {book.author} · {book.total_keywords} keyword{book.total_keywords === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="match-type-profile">
              Match-type strategy
            </label>
            <select
              id="match-type-profile"
              value={book.match_type_profile ?? "mixed"}
              onChange={(e) => updateMatchTypeProfile(e.target.value as "mixed" | "phrase-only")}
              className="input input-sm w-auto"
              title="Which match types the next generate run assigns (§21)"
            >
              <option value="mixed">Broad + Phrase + Exact</option>
              <option value="phrase-only">Phrase-only (+ Exact for comps)</option>
            </select>
          </div>
        </div>
      </header>

      <div className="page-body flex-1 space-y-6">
        {captureFailed && (
          <div className="alert alert-error" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Amazon didn&apos;t return this book&apos;s product page</p>
              <p className="mt-1">
                The metadata is incomplete and keyword generation needs it — re-fetch to try again.
              </p>
            </div>
          </div>
        )}

        {/* Captured metadata — the exact input keyword generation runs on. */}
        <section className="card">
          <div className="mb-5">
            <p className="card-title">Metadata from the ASIN scrape</p>
            <p className="meta-line mt-1">
              Captured {formatDate(snapshot.capturedAt)} · {mineable} data points available to the keyword
              generator
              {snapshot.capture?.completeness !== undefined &&
                ` · ${Math.round(snapshot.capture.completeness * 100)}% of listing fields read`}
            </p>
          </div>

          <div className="flex flex-wrap gap-6">
            {snapshot.coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Amazon CDN host isn't in next.config images.remotePatterns
              <img
                src={snapshot.coverImageUrl}
                alt={`${book.title} cover`}
                className="w-24 shrink-0 rounded-md border object-contain"
                style={{ borderColor: "var(--line)" }}
              />
            )}

            <div className="min-w-[260px] flex-1 space-y-5">
              <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs" style={{ color: "var(--text-secondary)" }}>
                      {label}
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              {genreTerms.length > 0 && (
                <div>
                  <p className="mb-2 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Genre vocabulary used to seed keywords
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {genreTerms.slice(0, 14).map((term) => (
                      <span key={term} className="chip-tag">
                        {term}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {snapshot.categoryPath && snapshot.categoryPath.length > 0 && (
                <div>
                  <p className="mb-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Amazon category path
                  </p>
                  <p className="text-sm" style={{ color: "var(--text-ui)" }}>
                    {snapshot.categoryPath.join(" › ")}
                  </p>
                </div>
              )}

              {snapshot.description && (
                <div>
                  <p className="mb-1 text-xs" style={{ color: "var(--text-secondary)" }}>
                    Description
                  </p>
                  <p className="line-clamp-4 text-sm" style={{ color: "var(--text-secondary)" }}>
                    {snapshot.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Grouped actions (spec: simplified buttons, no keywords/competitors toggle) — everything below is one working view of the book. */}
        <BookActionBar
          bookId={bookId}
          metadataReady={!captureFailed}
          onDataChanged={onDataChanged}
          onMetadataRefreshed={onDataChanged}
          onOpenManualAdd={() => setShowManualAdd(true)}
        />

        {/* Per-campaign list + "Filter & update campaign" (Create Campaigns itself lives in BookActionBar's Campaigns dropdown). */}
        <CampaignActions bookId={bookId} />

        <KeywordManager
          key={`bank-${dataKey}`}
          bookId={bookId}
          metadataCapturedAt={snapshot.capturedAt}
          onKeywordsChanged={reloadBook}
          manualAddOpen={showManualAdd}
          onOpenManualAdd={() => setShowManualAdd(true)}
          onCloseManualAdd={() => setShowManualAdd(false)}
        />
      </div>
    </div>
  );
}
