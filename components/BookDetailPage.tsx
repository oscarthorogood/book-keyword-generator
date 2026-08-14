"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, RefreshCw } from "lucide-react";
import BookCampaigns from "./BookCampaigns";
import BookStatTiles from "./BookStatTiles";
import BookRecentActivity from "./BookRecentActivity";
import TargetingFunnelWidget from "./dashboard/TargetingFunnelWidget";
import TargetingAccuracyWidget from "./dashboard/TargetingAccuracyWidget";

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
  const [refreshingMeta, setRefreshingMeta] = useState(false);
  const [metaNotice, setMetaNotice] = useState<string | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);

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

  /** Re-scrapes the Amazon listing — the one input every campaign is built from. */
  async function refreshMetadata() {
    setRefreshingMeta(true);
    setMetaError(null);
    setMetaNotice(null);
    try {
      const res = await fetch(`/api/books/${bookId}/refresh`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMetaError(body.error || "Could not re-fetch this book's metadata.");
        return;
      }
      setMetaNotice(body.warning ?? "Metadata re-fetched from Amazon.");
      await reloadBook();
    } catch {
      setMetaError("Could not re-fetch this book's metadata.");
    } finally {
      setRefreshingMeta(false);
    }
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
              {book.author} · <span className="font-mono">{book.asin}</span> · {book.marketplace}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="sr-only" htmlFor="match-type-profile">
              Match types to target
            </label>
            <select
              id="match-type-profile"
              value={book.match_type_profile ?? "mixed"}
              onChange={(e) => updateMatchTypeProfile(e.target.value as "mixed" | "phrase-only")}
              className="input input-sm w-auto"
              title="Which match types this book's campaigns target"
            >
              <option value="mixed">Broad + Phrase + Exact</option>
              <option value="phrase-only">Phrase-only (+ Exact for comps)</option>
            </select>
            <button onClick={refreshMetadata} disabled={refreshingMeta} className="btn btn-secondary btn-sm">
              {refreshingMeta ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
              {refreshingMeta ? "Re-fetching…" : "Re-fetch metadata"}
            </button>
          </div>
        </div>
      </header>

      <div className="page-body flex-1">
        {captureFailed && (
          <div className="alert alert-error mb-6" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <div>
              <p className="alert-title">Amazon didn&apos;t return this book&apos;s product page</p>
              <p className="mt-1">
                Campaigns are built from this metadata, so they can&apos;t be created until it reads — re-fetch to try
                again.
              </p>
            </div>
          </div>
        )}

        {metaError && (
          <div className="alert alert-error mb-6" role="alert">
            <AlertTriangle size={20} className="mt-0.5 shrink-0" />
            <p className="flex-1">{metaError}</p>
          </div>
        )}

        {metaNotice && (
          <div className="alert alert-success mb-6" aria-live="polite">
            <p className="flex-1">{metaNotice}</p>
          </div>
        )}

        <BookStatTiles bookId={bookId} genreTermCount={genreTerms.length} rating={snapshot.rating} />

        <div className="grid-split">
          <div className="flex flex-col gap-6">
            {/* Campaigns first — this is what the page is for. */}
            <BookCampaigns bookId={bookId} metadataReady={!captureFailed} onChanged={reloadBook} />

            {/* Captured metadata — the exact listing every campaign is built from. */}
            <section className="card">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
                <p className="card-title">Listing this book&apos;s campaigns are built from</p>
                <p className="whitespace-nowrap text-xs" style={{ color: "var(--text-placeholder)" }}>
                  Captured {formatDate(snapshot.capturedAt)}
                  {snapshot.capture?.completeness !== undefined &&
                    ` · ${Math.round(snapshot.capture.completeness * 100)}% of fields read`}
                </p>
              </div>

              <div className="flex gap-4">
                {snapshot.coverImageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- Amazon CDN host isn't in next.config images.remotePatterns
                  <img
                    src={snapshot.coverImageUrl}
                    alt={`${book.title} cover`}
                    className="w-14 shrink-0 rounded-md border object-contain"
                    style={{ borderColor: "var(--line)" }}
                  />
                )}

                <div className="min-w-0 flex-1 space-y-3">
                  <div className="flex flex-wrap gap-x-5 gap-y-1.5">
                    {facts.map(([label, value]) => (
                      <div key={label} className="flex items-baseline gap-1.5">
                        <span className="text-xs" style={{ color: "var(--text-placeholder)" }}>
                          {label}
                        </span>
                        <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                          {value}
                        </span>
                      </div>
                    ))}
                  </div>

                  {snapshot.description && (
                    <p className="line-clamp-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                      {snapshot.description}
                    </p>
                  )}

                  {snapshot.categoryPath && snapshot.categoryPath.length > 0 && (
                    <p className="text-xs" style={{ color: "var(--text-placeholder)" }}>
                      {snapshot.categoryPath.join(" › ")}
                    </p>
                  )}

                  {genreTerms.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {genreTerms.slice(0, 4).map((term) => (
                        <span key={term} className="chip-tag-accent">
                          {term}
                        </span>
                      ))}
                      {genreTerms.length > 4 && <span className="badge badge-gray">+{genreTerms.length - 4} more</span>}
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-6">
            <TargetingAccuracyWidget bookId={bookId} variant="sm" />
            <TargetingFunnelWidget bookId={bookId} variant="compact" />
            <BookRecentActivity bookId={bookId} capturedAt={snapshot.capturedAt} />
          </div>
        </div>
      </div>
    </div>
  );
}
