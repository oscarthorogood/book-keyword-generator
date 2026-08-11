/**
 * Reverse-ASIN import (spec §3) — Helium 10 Cerebro-style exports of the
 * keywords a competitor ASIN ranks for organically. Free-tier-friendly:
 * accepts pre-exported rows rather than scraping Helium 10 itself.
 */

import { normalize } from "./keywordMerge";
import { manualCompetitors } from "./manualCompetitors";
import { supabaseAdmin } from "./supabaseAdmin";
import { KeywordCandidate } from "./types";

/** One normalized row from a Cerebro/reverse-ASIN export. */
export interface ReverseAsinRow {
  text: string;
  /** Estimated monthly search volume for the term. */
  volume: number;
  /** The competitor ASIN's organic rank for this term (lower is stronger). */
  rank: number;
}

/** Minimum search volume for a reverse-ASIN term to be worth a keyword slot. */
export const MIN_VOLUME_FOR_KEEP = 50;
/** Maximum organic rank (worst position) still trusted as a real ranking signal. */
export const MAX_RANK_FOR_KEEP = 306;

const pickColumn = (row: Record<string, unknown>, keys: string[]): unknown => {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return undefined;
};

const toNumber = (value: unknown): number => {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const num = parseFloat(value.replace(/,/g, "").trim());
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
};

/** Helium 10 Cerebro export columns (the original/default shape this module was built against). */
export function parseHelium10Rows(rawRows: Array<Record<string, unknown>>): ReverseAsinRow[] {
  const rows: ReverseAsinRow[] = [];
  for (const raw of rawRows) {
    const text = pickColumn(raw, ["Keyword Phrase", "Keyword", "text", "keyword"]);
    if (typeof text !== "string" || !text.trim()) continue;
    rows.push({
      text: normalize(text),
      volume: toNumber(pickColumn(raw, ["Search Volume", "volume", "Exact Search Volume"])),
      rank: toNumber(pickColumn(raw, ["Position (Rank)", "Rank", "rank", "Organic Rank"])) || Infinity,
    });
  }
  return rows;
}

/** SellerSprite reverse-ASIN export columns. */
export function parseSellerSpriteRows(rawRows: Array<Record<string, unknown>>): ReverseAsinRow[] {
  const rows: ReverseAsinRow[] = [];
  for (const raw of rawRows) {
    const text = pickColumn(raw, ["Keywords", "Keyword", "text", "keyword"]);
    if (typeof text !== "string" || !text.trim()) continue;
    rows.push({
      text: normalize(text),
      volume: toNumber(pickColumn(raw, ["Searches", "Search Volume", "volume"])),
      rank: toNumber(pickColumn(raw, ["Natural Rank", "Rank", "rank"])) || Infinity,
    });
  }
  return rows;
}

/** KDPRadar reverse-ASIN export columns. */
export function parseKdpradarRows(rawRows: Array<Record<string, unknown>>): ReverseAsinRow[] {
  const rows: ReverseAsinRow[] = [];
  for (const raw of rawRows) {
    const text = pickColumn(raw, ["Search Term", "Keyword", "text", "keyword"]);
    if (typeof text !== "string" || !text.trim()) continue;
    rows.push({
      text: normalize(text),
      volume: toNumber(pickColumn(raw, ["Est. Searches", "Search Volume", "volume"])),
      rank: toNumber(pickColumn(raw, ["Rank", "Position", "rank"])) || Infinity,
    });
  }
  return rows;
}

/** DataDive reverse-ASIN export columns. */
export function parseDatadiveRows(rawRows: Array<Record<string, unknown>>): ReverseAsinRow[] {
  const rows: ReverseAsinRow[] = [];
  for (const raw of rawRows) {
    const text = pickColumn(raw, ["Phrase", "Keyword", "text", "keyword"]);
    if (typeof text !== "string" || !text.trim()) continue;
    rows.push({
      text: normalize(text),
      volume: toNumber(pickColumn(raw, ["Volume", "Search Volume", "volume"])),
      rank: toNumber(pickColumn(raw, ["Organic Rank", "Rank", "rank"])) || Infinity,
    });
  }
  return rows;
}

export type ReverseAsinTool = "helium10" | "sellersprite" | "kdpradar" | "datadive";

const TOOL_PARSERS: Record<ReverseAsinTool, (rows: Array<Record<string, unknown>>) => ReverseAsinRow[]> = {
  helium10: parseHelium10Rows,
  sellersprite: parseSellerSpriteRows,
  kdpradar: parseKdpradarRows,
  datadive: parseDatadiveRows,
};

/**
 * Tool-agnostic entry point: defaults to the Helium 10 Cerebro column shape
 * (this module's original/most common source) when no tool is given, so
 * every existing caller keeps working unchanged.
 */
export function parseReverseAsinRows(
  rawRows: Array<Record<string, unknown>>,
  tool: ReverseAsinTool = "helium10"
): ReverseAsinRow[] {
  return (TOOL_PARSERS[tool] ?? parseHelium10Rows)(rawRows);
}

/** True when the term itself names a known comp author for this book. */
function isCompAuthorTerm(text: string, asin: string | undefined, extraAuthors: string[]): boolean {
  const entry = asin ? manualCompetitors[asin] : undefined;
  const authors = [...(entry?.authors.map((a) => a.name) ?? []), ...extraAuthors];
  return authors.some((author) => text.includes(normalize(author)));
}

/** True when the term names a known comp title for this book. */
function isCompTitleTerm(text: string, asin: string | undefined, extraTitles: string[]): boolean {
  const entry = asin ? manualCompetitors[asin] : undefined;
  const titles = [...(entry?.titles ?? []), ...extraTitles];
  return titles.some((title) => text.includes(normalize(title)));
}

/**
 * Builds candidates from reverse-ASIN export rows, filtered to a reasonable
 * volume/rank threshold and classified as comp-name (author) or comp-title
 * against the book's own author and the manually curated comp library.
 */
export function buildReverseAsinCandidates(
  book: { author?: string; asin?: string },
  asinData: ReverseAsinRow[],
  options: {
    minVolume?: number;
    maxRank?: number;
    compAuthors?: string[];
    compTitles?: string[];
  } = {}
): KeywordCandidate[] {
  const minVolume = options.minVolume ?? MIN_VOLUME_FOR_KEEP;
  const maxRank = options.maxRank ?? MAX_RANK_FOR_KEEP;
  const compAuthors = options.compAuthors ?? [];
  const compTitles = options.compTitles ?? [];

  const kept = asinData.filter((row) => row.volume >= minVolume && row.rank <= maxRank);

  return kept.map((row) => {
    const isAuthorMatch =
      (book.author && row.text.includes(normalize(book.author))) ||
      isCompAuthorTerm(row.text, book.asin, compAuthors);
    const isTitleMatch = isCompTitleTerm(row.text, book.asin, compTitles);

    const category = isAuthorMatch ? "competing-authors" : isTitleMatch ? "comp-titles" : "sub-genre";
    const intentSegment = isAuthorMatch ? "comp-author" : isTitleMatch ? "comp-title" : "genre-core";
    const wordCount = row.text.split(/\s+/).filter(Boolean).length;

    const candidate: KeywordCandidate = {
      text: row.text,
      sources: ["reverse-asin"],
      category,
      intentSegment,
      matchType: isAuthorMatch || isTitleMatch ? "exact" : "phrase",
      specificity: isAuthorMatch || isTitleMatch ? 5 : wordCount >= 3 ? 4 : 3,
    };
    return candidate;
  });
}

// --- Multi-ASIN aggregation (spec §3.2) -------------------------------------

/** One reverse-ASIN row tagged with the competitor ASIN it was pulled from. */
export interface ReverseAsinWithAsin extends ReverseAsinRow {
  asin: string;
}

/** Higher default thresholds than the single-ASIN path: a term worth surfacing across a whole competitor set should clear a higher bar than one worth surfacing off a single ASIN. */
export const MIN_VOLUME_FOR_AGGREGATE_KEEP = 150;
export const MAX_RANK_FOR_AGGREGATE_KEEP = 306;
export const MIN_COMPETITOR_COUNT_FOR_AGGREGATE_KEEP = 2;

/** An aggregated reverse-ASIN row, with the extra multi-ASIN fields kept alongside it. */
export interface AggregatedReverseAsinRow extends ReverseAsinRow {
  /** Number of distinct competitor ASINs this term appeared for. */
  competitorCount: number;
  /** Average rank across those ASINs. Equal to `rank` when competitorCount is 1. */
  meanRank: number;
}

/**
 * Groups reverse-ASIN rows pulled from multiple competitor ASINs by text,
 * computing `competitorCount` (distinct ASINs the term ranks for) and
 * `meanRank` (average rank across them), then applies volume/rank/
 * competitor-count thresholds — a term only three different competitors'
 * books rank for is a much stronger genre-wide signal than the same term
 * off a single ASIN, so the defaults here are stricter than the
 * single-ASIN MIN_VOLUME_FOR_KEEP/MAX_RANK_FOR_KEEP.
 *
 * `volume` on the returned row is the max across the group (the strongest
 * observed demand signal for the term) rather than a sum, which would
 * double-count the same underlying search volume once per competitor ASIN
 * it happens to also rank for.
 */
export function aggregateReverseAsinRows(
  rows: ReverseAsinWithAsin[],
  options: {
    minVolume?: number;
    maxRank?: number;
    minCompetitorCount?: number;
  } = {}
): AggregatedReverseAsinRow[] {
  const minVolume = options.minVolume ?? MIN_VOLUME_FOR_AGGREGATE_KEEP;
  const maxRank = options.maxRank ?? MAX_RANK_FOR_AGGREGATE_KEEP;
  const minCompetitorCount = options.minCompetitorCount ?? MIN_COMPETITOR_COUNT_FOR_AGGREGATE_KEEP;

  const byText = new Map<string, ReverseAsinWithAsin[]>();
  for (const row of rows) {
    if (!row.text) continue;
    const key = row.text;
    if (!byText.has(key)) byText.set(key, []);
    byText.get(key)!.push(row);
  }

  const aggregated: AggregatedReverseAsinRow[] = [];
  for (const [text, group] of byText.entries()) {
    const asins = new Set(group.map((r) => r.asin));
    const ranks = group.map((r) => r.rank).filter((r) => Number.isFinite(r));
    const bestRank = ranks.length ? Math.min(...ranks) : Infinity;
    const meanRank = ranks.length ? ranks.reduce((sum, r) => sum + r, 0) / ranks.length : Infinity;
    const volume = Math.max(...group.map((r) => r.volume));

    aggregated.push({ text, volume, rank: bestRank, competitorCount: asins.size, meanRank });
  }

  return aggregated.filter(
    (row) => row.volume >= minVolume && row.rank <= maxRank && row.competitorCount >= minCompetitorCount
  );
}

// --- Building and persisting competitor candidates (spec §3.3) -------------

/**
 * Aggregates multi-ASIN reverse-ASIN rows, classifies them with the existing
 * buildReverseAsinCandidates logic, and upserts the result into
 * `competitor_keywords` (sql/15-competitor-asins.sql). Runs server-side only
 * (uses the service-role client) — the caller (an import API route) has
 * already checked the book belongs to the requesting user.
 *
 * Dedupes on (book_id, text, competitor_asin) via upsert, so re-importing the
 * same export is a no-op rather than piling up duplicate rows; when a term
 * came from several ASINs, the row is attributed to the strongest-ranking
 * one (lowest individual rank) with competitor_count/mean_rank carrying the
 * cross-ASIN signal.
 */
export async function buildAndStoreCompetitorCandidates(
  book: { id: string; userId: string; author?: string; asin?: string },
  rows: ReverseAsinWithAsin[],
  extraAuthors: string[] = [],
  extraTitles: string[] = []
): Promise<{ storedCount: number; candidateCount: number }> {
  const aggregated = aggregateReverseAsinRows(rows);
  if (aggregated.length === 0) return { storedCount: 0, candidateCount: 0 };

  const candidates = buildReverseAsinCandidates(
    { author: book.author, asin: book.asin },
    aggregated,
    { compAuthors: extraAuthors, compTitles: extraTitles }
  );

  const byText = new Map(aggregated.map((row) => [row.text, row]));

  // Attribute each kept term to whichever competitor ASIN ranked strongest
  // for it, since competitor_keywords stores one row per (book, text, asin).
  const bestAsinForText = new Map<string, string>();
  for (const row of rows) {
    const current = bestAsinForText.get(row.text);
    const currentBest = current ? rows.find((r) => r.text === row.text && r.asin === current) : undefined;
    if (!current || (currentBest && row.rank < currentBest.rank)) {
      bestAsinForText.set(row.text, row.asin);
    }
  }

  const dbRows = candidates.map((candidate) => {
    const agg = byText.get(candidate.text);
    return {
      book_id: book.id,
      user_id: book.userId,
      competitor_asin: bestAsinForText.get(candidate.text) ?? rows[0]?.asin ?? "unknown",
      text: candidate.text,
      volume: agg?.volume ?? 0,
      rank: Number.isFinite(agg?.rank) ? agg?.rank : null,
      competitor_count: agg?.competitorCount ?? 1,
      mean_rank: agg && Number.isFinite(agg.meanRank) ? agg.meanRank : null,
      category: candidate.category ?? null,
      intent_segment: candidate.intentSegment ?? null,
      match_type: candidate.matchType ?? "phrase",
      specificity: candidate.specificity ?? null,
    };
  });

  if (dbRows.length === 0) return { storedCount: 0, candidateCount: candidates.length };

  const supabase = supabaseAdmin();
  const { error } = await supabase
    .from("competitor_keywords")
    .upsert(dbRows, { onConflict: "book_id,text,competitor_asin", ignoreDuplicates: false });

  if (error) {
    console.error("Failed to store competitor keywords:", error.message);
    return { storedCount: 0, candidateCount: candidates.length };
  }

  return { storedCount: dbRows.length, candidateCount: candidates.length };
}
