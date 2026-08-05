import ExcelJS from "exceljs";
import { Readable } from "stream";
import { isGarbledText, isScrapedBoilerplate } from "./keywordMerge";
import { looksLikeAsin } from "./productTargets";
import {
  HarvestDecision,
  HarvestSummary,
  HarvestVerdict,
  KeywordCandidate,
  ProductTargetCandidate,
  SearchTermRow,
} from "./types";

/**
 * Second half of the two-phase discovery-then-harvest workflow: ingest an
 * Auto campaign's Search Term report and promote/negate terms into a Manual
 * campaign, instead of only ever generating a cold-start keyword list. See
 * the learnings doc, section 1.
 */

function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const HEADER_ALIAS_MAP: { field: keyof SearchTermRow; aliases: string[] }[] = [
  { field: "searchTerm", aliases: ["customersearchterm", "searchterm"] },
  { field: "targeting", aliases: ["targeting"] },
  { field: "matchType", aliases: ["matchtype"] },
  { field: "impressions", aliases: ["impressions"] },
  { field: "clicks", aliases: ["clicks"] },
  { field: "spend", aliases: ["spend", "cost"] },
  { field: "orders", aliases: ["7daytotalorders", "totalorders", "orders", "7daytotalorders#"] },
  { field: "sales", aliases: ["7daytotalsales", "totalsales", "sales"] },
];

function parseNumber(value: ExcelJS.CellValue): number {
  if (typeof value === "number") return value;
  if (value == null) return 0;
  const text = String(value).replace(/[^0-9.-]/g, "");
  const n = parseFloat(text);
  return Number.isFinite(n) ? n : 0;
}

async function loadWorksheet(buffer: Buffer, filename: string): Promise<ExcelJS.Worksheet | undefined> {
  const workbook = new ExcelJS.Workbook();
  if (/\.csv$/i.test(filename)) {
    return await workbook.csv.read(Readable.from(buffer));
  }
  // exceljs's bundled .d.ts declares its own module-local `Buffer extends
  // ArrayBuffer`, which doesn't structurally match @types/node's Buffer (a
  // Uint8Array) — loading a real Buffer is correct at runtime, this just
  // satisfies the mismatched ambient type.
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook.worksheets[0];
}

/** Parses an Amazon Search Term report (.xlsx or .csv). Best-effort column matching to survive header drift/renames. */
export async function parseSearchTermReport(buffer: Buffer, filename: string): Promise<SearchTermRow[]> {
  const sheet = await loadWorksheet(buffer, filename);
  if (!sheet || sheet.rowCount < 2) return [];

  const colByField = new Map<keyof SearchTermRow, number>();
  sheet.getRow(1).eachCell((cell, colNumber) => {
    const normalized = normalizeHeader(String(cell.value ?? ""));
    for (const { field, aliases } of HEADER_ALIAS_MAP) {
      if (!colByField.has(field) && aliases.includes(normalized)) {
        colByField.set(field, colNumber);
      }
    }
  });

  const searchTermCol = colByField.get("searchTerm");
  if (!searchTermCol) return [];

  const getText = (row: ExcelJS.Row, field: keyof SearchTermRow): string | undefined => {
    const col = colByField.get(field);
    if (!col) return undefined;
    const text = String(row.getCell(col).value ?? "").trim();
    return text || undefined;
  };
  const getNumber = (row: ExcelJS.Row, field: keyof SearchTermRow): number => {
    const col = colByField.get(field);
    return col ? parseNumber(row.getCell(col).value) : 0;
  };

  const rows: SearchTermRow[] = [];
  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const searchTerm = String(row.getCell(searchTermCol).value ?? "").trim();
    if (!searchTerm) continue;

    rows.push({
      searchTerm,
      targeting: getText(row, "targeting"),
      matchType: getText(row, "matchType"),
      impressions: getNumber(row, "impressions"),
      clicks: getNumber(row, "clicks"),
      spend: getNumber(row, "spend"),
      orders: getNumber(row, "orders"),
      sales: getNumber(row, "sales"),
    });
  }
  return rows;
}

export interface HarvestThresholds {
  /** Below this many impressions there isn't enough signal to act either way. */
  minImpressionsForSignal: number;
  /** This many clicks with zero orders is enough evidence to negative-match. */
  minClicksToNegate: number;
  /** This many orders is enough to consider promoting, subject to the ACOS check. */
  minOrdersToPromote: number;
  /** Term-level ACOS at or below this qualifies for promotion. */
  targetAcos: number;
}

// Amazon's own account here showed the expected power-law shape (364
// MONITOR / 138 LOW_IMPRESSIONS out of ~500 terms, only a handful STRONG) —
// see the learnings doc, section 6. These defaults are deliberately
// conservative so most of the long tail lands in monitor/low-impressions
// rather than being force-promoted or force-negated on thin data.
export const DEFAULT_HARVEST_THRESHOLDS: HarvestThresholds = {
  minImpressionsForSignal: 300,
  minClicksToNegate: 8,
  minOrdersToPromote: 1,
  targetAcos: 0.35,
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function classifySearchTerm(row: SearchTermRow, thresholds: HarvestThresholds): HarvestDecision {
  const term = row.searchTerm.trim();
  const isAsin = looksLikeAsin(term);

  if (!isAsin && (isGarbledText(term) || isScrapedBoilerplate(term.toLowerCase()))) {
    return { row, verdict: "junk", isAsin };
  }

  const acos = row.sales > 0 ? row.spend / row.sales : row.spend > 0 ? Infinity : 0;

  if (row.orders >= thresholds.minOrdersToPromote && acos <= thresholds.targetAcos) {
    const cpc = row.clicks > 0 ? row.spend / row.clicks : undefined;
    // Bid slightly above the CPC that already proved it converts, so the
    // promoted term doesn't immediately lose the auction it won as an Auto target.
    return { row, verdict: "promote", isAsin, suggestedBid: cpc !== undefined ? round2(cpc * 1.1) : undefined };
  }

  if (row.orders === 0 && row.clicks >= thresholds.minClicksToNegate) {
    return { row, verdict: "negate", isAsin };
  }

  if (row.impressions < thresholds.minImpressionsForSignal) {
    return { row, verdict: "low-impressions", isAsin };
  }

  return { row, verdict: "monitor", isAsin };
}

export function classifySearchTerms(
  rows: SearchTermRow[],
  thresholds: HarvestThresholds = DEFAULT_HARVEST_THRESHOLDS
): HarvestDecision[] {
  return rows.map((row) => classifySearchTerm(row, thresholds));
}

export function summarizeHarvest(decisions: HarvestDecision[]): HarvestSummary {
  const summary: HarvestSummary = {
    promoted: 0,
    negated: 0,
    monitored: 0,
    lowImpressions: 0,
    junk: 0,
    total: decisions.length,
  };

  const counters: Record<HarvestVerdict, keyof Omit<HarvestSummary, "total">> = {
    promote: "promoted",
    negate: "negated",
    monitor: "monitored",
    "low-impressions": "lowImpressions",
    junk: "junk",
  };

  for (const decision of decisions) {
    summary[counters[decision.verdict]]++;
  }

  return summary;
}

export interface HarvestOutputs {
  keywords: KeywordCandidate[];
  productTargets: ProductTargetCandidate[];
  negativeKeywords: string[];
}

/** Converts harvest verdicts into the same shapes the generator's bulksheet writer already accepts. */
export function buildHarvestOutputs(decisions: HarvestDecision[], baseBid: number): HarvestOutputs {
  const keywords: KeywordCandidate[] = [];
  const productTargets: ProductTargetCandidate[] = [];
  const negativeKeywords: string[] = [];

  for (const decision of decisions) {
    const term = decision.row.searchTerm.trim();

    if (decision.verdict === "promote") {
      if (decision.isAsin) {
        productTargets.push({
          asin: term.toUpperCase(),
          sources: ["harvest"],
          suggestedBid: decision.suggestedBid ?? baseBid,
        });
      } else {
        keywords.push({
          text: term.toLowerCase(),
          sources: ["harvest"],
          suggestedBid: decision.suggestedBid ?? baseBid,
        });
      }
    } else if (decision.verdict === "negate" && !decision.isAsin) {
      negativeKeywords.push(term.toLowerCase());
    }
  }

  return { keywords, productTargets, negativeKeywords };
}
