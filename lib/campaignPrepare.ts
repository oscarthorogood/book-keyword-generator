/**
 * Fills a book's keyword/ASIN bank on demand, from the server, so campaign
 * creation is the only thing the user has to press.
 *
 * The bank used to be a first-class part of the book page: Generate, Genre
 * Presets and Run Filters were buttons, and the user was expected to press
 * them in the right order before Create Campaigns would find anything to
 * select from. That whole surface is gone (books are organised around
 * campaigns now) but the pipeline behind it is unchanged — it just runs
 * here instead, triggered by POST /api/books/[id]/campaigns.
 *
 * Ordering follows the flowchart's Create Campaigns branch exactly:
 *   1. "Use Generation to find keywords (300) and add to all bank" — runs
 *      first, at the full BOOK_KEYWORD_MAX cap rather than the generate
 *      form's 50-per-ad-group default. Every new row lands in `archived`
 *      (PR #61), never straight into `active`.
 *   2. "Collect Preset Keywords and ASINs" — genre presets are applied on
 *      top of what generation found.
 *   3. "Run Through Filter" — the only step that promotes `archived` rows
 *      into `active`, which is the status lib/campaignContext.ts selects
 *      from. Step 3's "collect ASINs and keywords stored in our database
 *      from all generation or manual input" is that same read: the filter
 *      pass and loadCampaignContext both read the book's whole bank back,
 *      generated and hand-added rows alike.
 *
 * Skipping rules keep this cheap and idempotent. Generation costs real
 * upstream API calls, so it only runs when the book has nothing at all;
 * if rows already exist but are stuck in `archived`, only the (free, local)
 * filter pass runs. When the campaign-eligible bank is already populated,
 * nothing runs at all — which is what makes the confirmation round-trip on
 * Create Campaigns safe to re-enter.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { BOOK_KEYWORD_MAX } from "./keywordMerge";

/**
 * The route handlers are pulled in lazily, inside prepareBank, rather than
 * at module load. They reach into `next/headers` and the whole scraping
 * stack, which makes this module unimportable outside a request — including
 * from the unit tests that cover the skip rules below.
 */
async function pipelineHandlers() {
  const [keywordPresets, keywordFilter, keywordGenerate, asinPresets, asinFilter, asinGenerate] = await Promise.all([
    import("@/app/api/books/[id]/keywords/apply-presets/route"),
    import("@/app/api/books/[id]/keywords/filter/route"),
    import("@/app/api/books/[id]/keywords/generate/route"),
    import("@/app/api/books/[id]/competitors/apply-presets/route"),
    import("@/app/api/books/[id]/competitors/filter/route"),
    import("@/app/api/books/[id]/competitors/generate/route"),
  ]);
  return {
    applyKeywordPresets: keywordPresets.POST,
    filterKeywords: keywordFilter.POST,
    generateKeywords: keywordGenerate.POST,
    applyAsinPresets: asinPresets.POST,
    filterAsins: asinFilter.POST,
    generateAsins: asinGenerate.POST,
  };
}

/** What prepareBank actually did, so the API response can explain itself. */
export interface PrepareBankResult {
  /** False when the eligible bank was already populated and nothing ran. */
  ran: boolean;
  generated: boolean;
  filtered: boolean;
  presetsApplied: number;
  generatedKeywords: number;
  generatedAsins: number;
  /** Rows the filter pass examined across both pipelines. */
  examined: number;
  /** Non-fatal failures — one pipeline can fail while the other still fills the bank. */
  warnings: string[];
}

type RouteHandler = (request: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;

/** What a bank in a given state needs doing to it. */
export interface PreparePlan {
  /** Run presets + generation — costs real upstream API calls. */
  generate: boolean;
  /** Run the filter pass, which promotes archived rows into active. */
  filter: boolean;
}

/**
 * Decides what to run from the bank's current counts. Pure, and separated
 * out because getting it wrong is expensive in both directions: too eager
 * and every Create Campaigns press re-pays for generation, too lazy and
 * campaigns are built from an empty bank.
 *
 * @param eligible rows campaign selection can see (active/paused)
 * @param total    rows of any non-rejected status, including archived
 */
export function planPrepare(eligible: number, total: number): PreparePlan {
  // Selection already has something to work with — never spend anything.
  if (eligible > 0) return { generate: false, filter: false };
  // Rows exist but are all archived: the filter pass alone can promote them,
  // and it's local and free.
  if (total > 0) return { generate: false, filter: true };
  // Nothing at all — this book has never been researched.
  return { generate: true, filter: true };
}

/**
 * Invokes a route handler in-process rather than over HTTP.
 *
 * These handlers are plain async functions; they read auth and the Supabase
 * client from `next/headers` cookies, which are already in scope because we
 * are inside the campaigns request. Calling them directly reuses ~2,000
 * lines of generation/filtering logic without an internal fetch (which would
 * need the cookie forwarded and a resolvable origin) and without lifting
 * that logic into lib/ wholesale.
 */
async function callRoute(
  handler: RouteHandler,
  bookId: string,
  path: string,
  body: Record<string, unknown> = {}
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const request = new Request(`http://internal/api/books/${bookId}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await handler(request, { params: Promise.resolve({ id: bookId }) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, status: response.status, data };
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function errorText(data: Record<string, unknown>, fallback: string): string {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

/** Counts what's in the bank now, split by whether campaign selection can see it. */
async function countBank(supabase: SupabaseClient, bookId: string, userId: string) {
  const [eligibleKeywords, eligibleAsins, anyKeywords, anyAsins] = await Promise.all([
    supabase
      .from("keywords")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .in("status", ["active", "paused"]),
    supabase
      .from("competitor_asins")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .in("status", ["active", "paused"]),
    supabase
      .from("keywords")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .neq("status", "rejected"),
    supabase
      .from("competitor_asins")
      .select("id", { count: "exact", head: true })
      .eq("book_id", bookId)
      .eq("user_id", userId)
      .neq("status", "rejected"),
  ]);

  return {
    eligible: (eligibleKeywords.count ?? 0) + (eligibleAsins.count ?? 0),
    total: (anyKeywords.count ?? 0) + (anyAsins.count ?? 0),
  };
}

/**
 * Ensures `bookId` has a campaign-eligible bank, generating and filtering as
 * needed. Never throws for a pipeline failure — a half-filled bank still
 * makes campaigns, and the caller reports the leftover `warnings` alongside
 * whatever it managed to create.
 */
export async function prepareBank(
  supabase: SupabaseClient,
  bookId: string,
  userId: string
): Promise<PrepareBankResult> {
  const result: PrepareBankResult = {
    ran: false,
    generated: false,
    filtered: false,
    presetsApplied: 0,
    generatedKeywords: 0,
    generatedAsins: 0,
    examined: 0,
    warnings: [],
  };

  const before = await countBank(supabase, bookId, userId);
  const plan = planPrepare(before.eligible, before.total);
  if (!plan.generate && !plan.filter) return result;

  result.ran = true;

  const {
    applyKeywordPresets,
    filterKeywords,
    generateKeywords,
    applyAsinPresets,
    filterAsins,
    generateAsins,
  } = await pipelineHandlers();

  if (plan.generate) {
    // Step 1: generation, at the flowchart's 300. Without an explicit cap
    // the route falls back to RECOMMENDED_MAX_KEYWORDS (50 per ad group),
    // which was right for a human filling in the old Generate form and far
    // too small for an unattended run feeding five campaigns.
    const [keywords, asins] = await Promise.all([
      callRoute(generateKeywords, bookId, "keywords/generate", { resultCap: BOOK_KEYWORD_MAX }),
      callRoute(generateAsins, bookId, "competitors/generate"),
    ]);
    result.generated = true;
    result.generatedKeywords = num(keywords.data.insertedCount);
    result.generatedAsins = num(asins.data.insertedCount);

    // A failed metadata capture blocks generation outright (422 needsRefresh)
    // and there is no bank to fall back on, so surface it as the headline
    // problem rather than burying it behind "no eligible targets".
    if (!keywords.ok && keywords.data.needsRefresh) {
      result.warnings.push(errorText(keywords.data, "This book's Amazon metadata could not be read."));
      return result;
    }
    if (!keywords.ok) result.warnings.push(errorText(keywords.data, "Could not generate keywords."));
    if (!asins.ok) result.warnings.push(errorText(asins.data, "Could not generate competitor ASINs."));
  }

  // Step 2: genre presets, applied on top of whatever the bank now holds.
  //
  // Unconditional, unlike generation. The flowchart has this as its own
  // step in the line, and it costs nothing to repeat: both preset routes
  // dedupe against the book's existing keywords/ASINs first, so a re-run
  // adds only presets that are genuinely missing. Nesting it inside the
  // generation branch meant a book whose rows were all archived — the
  // filter-only path — never picked up presets added since its last run.
  const [keywordPresets, asinPresets] = await Promise.all([
    callRoute(applyKeywordPresets, bookId, "keywords/apply-presets"),
    callRoute(applyAsinPresets, bookId, "competitors/apply-presets"),
  ]);
  result.presetsApplied = num(keywordPresets.data.appliedCount) + num(asinPresets.data.appliedCount);
  if (!keywordPresets.ok) result.warnings.push(errorText(keywordPresets.data, "Could not apply keyword presets."));
  if (!asinPresets.ok) result.warnings.push(errorText(asinPresets.data, "Could not apply ASIN presets."));

  // Step 3: promotes archived rows into active — the step campaign
  // selection needs, and the one that reads the book's whole bank back
  // (generated, preset and manually added rows alike).
  const [keywordFilter, asinFilter] = await Promise.all([
    callRoute(filterKeywords, bookId, "keywords/filter"),
    callRoute(filterAsins, bookId, "competitors/filter"),
  ]);
  result.filtered = true;
  result.examined = num(keywordFilter.data.examined) + num(asinFilter.data.examined);
  if (!keywordFilter.ok) result.warnings.push(errorText(keywordFilter.data, "Could not run the keyword filters."));
  if (!asinFilter.ok) result.warnings.push(errorText(asinFilter.data, "Could not run the ASIN filters."));

  return result;
}

/** One-line summary of a prepare run, for the notice shown after Create Campaigns. */
export function describePrepare(result: PrepareBankResult): string | null {
  if (!result.ran) return null;
  const parts: string[] = [];
  if (result.generated) {
    parts.push(`generated ${result.generatedKeywords} keyword(s) and ${result.generatedAsins} ASIN(s)`);
  }
  if (result.presetsApplied > 0) parts.push(`applied ${result.presetsApplied} preset row(s)`);
  if (result.filtered) parts.push(`filtered ${result.examined} row(s)`);
  if (parts.length === 0) return null;
  return `Prepared this book's targets first — ${parts.join(", ")}.`;
}
