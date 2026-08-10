"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, AlertTriangle, RefreshCw } from "lucide-react";
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
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function refreshMetadata() {
    setRefreshing(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/books/${bookId}/refresh`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(body.error || "Could not re-fetch the metadata.");
        return;
      }
      setBook(body.book as Book);
      setNotice(body.warning ?? "Metadata re-fetched from Amazon.");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not re-fetch the metadata.");
    } finally {
      setRefreshing(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg-mid)" }}>
        <div className="text-center">
          <div className="animate-spin w-10 h-10 border-4 rounded-full mx-auto mb-4 border-t-transparent" />
          <p style={{ color: "var(--muted)" }}>Loading book…</p>
        </div>
      </div>
    );
  }

  if (!book) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-mid)" }}>
        <header className="border-b px-8 py-6">
          <button onClick={onBack} className="inline-flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
            <ArrowLeft size={18} />
            Back to books
          </button>
        </header>
        <div className="flex-1 flex items-center justify-center">
          <p style={{ color: "var(--muted)" }}>Book not found.</p>
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
      ? ([["Formats", snapshot.formats.join(", ") + (snapshot.isKindleUnlimited ? " · KU" : "")]] as Array<
          [string, string]
        >)
      : []),
    ...(snapshot.bestSellerRanks?.length
      ? ([["Best seller rank", `#${snapshot.bestSellerRanks[0].rank} in ${snapshot.bestSellerRanks[0].category}`]] as Array<
          [string, string]
        >)
      : []),
  ];

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "var(--bg-mid)" }}>
      <header className="border-b px-8 py-6">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm mb-4"
          style={{ color: "var(--muted)" }}
        >
          <ArrowLeft size={18} />
          Back to books
        </button>
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: "var(--ink)" }}>
              {book.title}
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>
              by {book.author} · {book.total_keywords} keyword{book.total_keywords === 1 ? "" : "s"}
            </p>
          </div>
          <button onClick={refreshMetadata} disabled={refreshing} className="btn-pill-outline">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Re-fetching…" : "Re-fetch metadata"}
          </button>
        </div>
      </header>

      <div className="flex-1 px-8 py-8 space-y-6">
        {(captureFailed || notice) && (
          <div
            className="status-banner"
            style={
              captureFailed
                ? { background: "var(--accent-red-soft)", borderColor: "var(--accent-red)" }
                : { background: "var(--panel-muted)" }
            }
          >
            {captureFailed ? (
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" style={{ color: "var(--accent-red)" }} />
            ) : (
              <span className="status-dot" style={{ background: "var(--accent-green)" }} />
            )}
            <div>
              {captureFailed && (
                <p className="font-medium" style={{ color: "var(--ink)" }}>
                  Amazon didn&apos;t return this book&apos;s product page, so the metadata is incomplete.
                  Keyword generation needs it — re-fetch to try again.
                </p>
              )}
              {notice && (
                <p className={captureFailed ? "text-xs mt-1" : undefined} style={{ color: "var(--muted)" }}>
                  {notice}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Captured metadata — the exact input keyword generation runs on. */}
        <section className="card">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <p className="card-title">Metadata from the ASIN scrape</p>
              <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                Captured {formatDate(snapshot.capturedAt)} · {mineable} data points available to the keyword
                generator
                {snapshot.capture?.completeness !== undefined &&
                  ` · ${Math.round(snapshot.capture.completeness * 100)}% of listing fields read`}
              </p>
            </div>
          </div>

          <div className="flex gap-6 flex-wrap">
            {snapshot.coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Amazon CDN host isn't in next.config images.remotePatterns
              <img
                src={snapshot.coverImageUrl}
                alt={`${book.title} cover`}
                className="w-24 rounded-lg border object-contain flex-shrink-0"
              />
            )}

            <div className="flex-1 min-w-[260px] space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3">
                {facts.map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs" style={{ color: "var(--muted)" }}>
                      {label}
                    </p>
                    <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {genreTerms.length > 0 && (
                <div>
                  <p className="text-xs mb-2" style={{ color: "var(--muted)" }}>
                    Genre vocabulary used to seed keywords
                  </p>
                  <div className="flex flex-wrap gap-1.5">
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
                  <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
                    Amazon category path
                  </p>
                  <p className="text-sm" style={{ color: "var(--ink)" }}>
                    {snapshot.categoryPath.join(" › ")}
                  </p>
                </div>
              )}

              {snapshot.description && (
                <div>
                  <p className="text-xs mb-1" style={{ color: "var(--muted)" }}>
                    Description
                  </p>
                  <p className="text-sm leading-relaxed line-clamp-4" style={{ color: "var(--ink)" }}>
                    {snapshot.description}
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>

        <KeywordManager
          bookId={bookId}
          metadataCapturedAt={snapshot.capturedAt}
          metadataReady={!captureFailed}
          genreTerms={genreTerms}
          onKeywordsChanged={reloadBook}
        />
      </div>
    </div>
  );
}
