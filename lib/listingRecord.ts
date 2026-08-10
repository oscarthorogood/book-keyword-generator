/**
 * `ListingRecord` — one validated, structured record per Amazon listing.
 *
 * Everything the pipeline knows about a page used to live in the loosely
 * typed ProductPageData/BookSnapshot pair, where "the selector broke" and
 * "the page genuinely has no series name" look identical. This is the
 * schema the metadata spec asks for: one shape, validated on every capture,
 * with per-field extraction success recorded so selector drift shows up as a
 * falling success rate instead of a quietly thinner keyword list.
 *
 * Validation is hand-rolled rather than Zod/Yup: the app has no schema
 * library today, the shape is flat, and every field but a handful is
 * nullable by design — a missing field must never crash a capture.
 */

import type { Marketplace } from "./types";

export interface ListingRecord {
  // --- record metadata (§2.4) --------------------------------------------
  asin: string;
  marketplace: Marketplace;
  /** ISO timestamp of the capture. */
  scrapedAt: string;
  sourceUrl: string;
  /** False for the advertiser's own book, true for a comparable title. */
  isCompetitor: boolean;

  // --- core listing fields (§2.1) ----------------------------------------
  title?: string;
  bullets: string[];
  description?: string;
  brand?: string;
  categoryPath: string[];
  variations: string[];

  // --- HTML-level metadata (§2.2) ----------------------------------------
  htmlTitle?: string;
  metaKeywords: string[];
  metaDescription?: string;
  urlSlug?: string;
  structuredData: Array<Record<string, unknown>>;

  // --- contextual signals (§2.3) -----------------------------------------
  bsr: Array<{ rank: number; category: string }>;
  relatedAsins: string[];
  reviewSnippets: string[];
  qaSnippets: string[];
  reviewCount?: number;
  rating?: number;
  price?: number;

  // --- format availability (needed by the format filter) ------------------
  formats: string[];
  isKindleUnlimited: boolean;
  language?: string;
}

/** Dedup key. One book, one marketplace, one record. */
export function listingRecordKey(record: Pick<ListingRecord, "asin" | "marketplace">): string {
  return `${record.asin.toUpperCase()}:${record.marketplace}`;
}

/** Fields whose absence means the record is not usable at all. */
const REQUIRED_FIELDS: Array<keyof ListingRecord> = ["asin", "marketplace", "scrapedAt", "sourceUrl"];

/**
 * Fields tracked for extraction success. A field below the threshold in
 * `summariseFieldCoverage` is a selector that needs a fallback, not a run of
 * unusual books.
 */
export const TRACKED_FIELDS: Array<keyof ListingRecord> = [
  "title",
  "bullets",
  "description",
  "brand",
  "categoryPath",
  "variations",
  "htmlTitle",
  "metaKeywords",
  "metaDescription",
  "urlSlug",
  "structuredData",
  "bsr",
  "relatedAsins",
  "reviewSnippets",
  "qaSnippets",
  "reviewCount",
  "rating",
  "price",
  "formats",
  "language",
];

const ASIN_PATTERN = /^[A-Z0-9]{10}$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  /** Field → whether the capture produced a value. */
  coverage: Record<string, boolean>;
  /** Share of TRACKED_FIELDS that came back populated, 0-1. */
  completeness: number;
}

function isPopulated(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  return true;
}

/**
 * Validates a record and reports which fields the capture actually found.
 * Never throws: a listing missing everything but its ASIN still returns a
 * result, flagged invalid, so the caller can log it and move on rather than
 * taking the whole run down.
 */
export function validateListingRecord(record: ListingRecord): ValidationResult {
  const errors: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (!isPopulated(record[field])) errors.push(`missing required field: ${String(field)}`);
  }
  if (record.asin && !ASIN_PATTERN.test(record.asin.toUpperCase())) {
    errors.push(`asin "${record.asin}" is not a 10-character ASIN`);
  }
  if (record.scrapedAt && Number.isNaN(Date.parse(record.scrapedAt))) {
    errors.push(`scrapedAt "${record.scrapedAt}" is not an ISO timestamp`);
  }
  if (record.rating !== undefined && (record.rating < 0 || record.rating > 5)) {
    errors.push(`rating ${record.rating} is outside 0-5`);
  }
  // A record with no title *and* no description has nothing to mine; that's
  // a blocked page, not a sparse listing.
  if (!isPopulated(record.title) && !isPopulated(record.description)) {
    errors.push("no title and no description — the page was almost certainly not read");
  }

  const coverage: Record<string, boolean> = {};
  for (const field of TRACKED_FIELDS) coverage[String(field)] = isPopulated(record[field]);
  const found = Object.values(coverage).filter(Boolean).length;

  return {
    valid: errors.length === 0,
    errors,
    coverage,
    completeness: TRACKED_FIELDS.length === 0 ? 0 : found / TRACKED_FIELDS.length,
  };
}

/** Normalises free text the way the keyword pipeline expects: entities decoded, whitespace collapsed, original casing preserved. */
export function normalizeListingText(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const decoded = raw
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  const collapsed = decoded.replace(/\s+/g, " ").trim();
  return collapsed || undefined;
}

export interface FieldCoverageSummary {
  records: number;
  /** Field → share of records where it was populated, 0-1. */
  rates: Record<string, number>;
  /** Fields under the threshold — these are the ones needing fallback selectors. */
  weakFields: string[];
}

/**
 * Aggregates coverage across a batch of records. The metadata spec's
 * definition of done is "any field <80% success has fallback selectors", so
 * that's the default threshold.
 */
export function summariseFieldCoverage(results: ValidationResult[], threshold = 0.8): FieldCoverageSummary {
  const rates: Record<string, number> = {};
  if (results.length === 0) return { records: 0, rates, weakFields: [] };

  for (const field of TRACKED_FIELDS) {
    const key = String(field);
    const found = results.filter((result) => result.coverage[key]).length;
    rates[key] = found / results.length;
  }

  return {
    records: results.length,
    rates,
    weakFields: Object.entries(rates)
      .filter(([, rate]) => rate < threshold)
      .map(([field]) => field),
  };
}

/** One-line server log of what a capture actually got, so a drifting selector is visible in the logs. */
export function logFieldCoverage(record: ListingRecord, result: ValidationResult): void {
  const missing = Object.entries(result.coverage)
    .filter(([, found]) => !found)
    .map(([field]) => field);
  console.warn(
    `[listingRecord] ${listingRecordKey(record)} ${Math.round(result.completeness * 100)}% of tracked fields` +
      (missing.length > 0 ? ` · missing: ${missing.join(", ")}` : "") +
      (result.errors.length > 0 ? ` · errors: ${result.errors.join("; ")}` : "")
  );
}
