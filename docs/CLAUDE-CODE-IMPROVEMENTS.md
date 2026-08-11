# CLAUDE-CODE-IMPROVEMENTS.md

## Purpose

This spec captures a set of architecture, reliability, and test improvements for the `book-keyword-generator` app. It is written as an implementation guide for Claude Code (or another coding assistant) and assumes the current codebase on the `main` branch.

## Scope

These tasks focus on:
- AI relevance ranking and Groq integration
- Keyword and competitor ASIN generation/filter pipelines
- Type-safety, configuration validation, and logging
- Developer experience via tests and documentation

Key files involved:
- `app/api/books/[id]/keywords/generate/route.ts`
- `app/api/books/[id]/keywords/filter/route.ts`
- `app/api/books/[id]/competitors/generate/route.ts`
- `app/api/books/[id]/competitors/filter/route.ts`
- `lib/aiRanker.ts`
- `lib/groqClient.ts`
- `lib/groqKeywordSource.ts`
- `lib/types.ts`

---

## 1. Add tests for AI ranking and competitor flows

### 1.1 AI ranking tests

**Goal:** Ensure `rankKeywordsWithAi` behaves correctly across Gemini, OpenRouter, and Groq, and fails soft when none are configured or all calls fail.

1. Create a test file, e.g. `lib/__tests__/aiRanker.test.ts` using your existing test runner (Vitest/Jest).
2. In `aiRanker` tests, mock `callOpenRouter`, `callGroq`, and the Gemini client so you can simulate:
   - Gemini success
   - Gemini failure + OpenRouter success
   - Gemini failure + OpenRouter failure + Groq success
   - All three failing or not configured, returning `null` instead of throwing.
3. Assert that `rankKeywordsWithAi`:
   - Returns ranked keyword arrays with expected categories and scores when a backend succeeds.
   - Returns `null` when no backend is configured or all calls fail.
   - Never throws; errors should be logged via `console.error` (later replaced with the logging utility in section 5).

### 1.2 Keyword filter tests

**Goal:** Verify AI relevance re-rank and heuristic filters interact correctly in `keywords/filter`.

1. Create `app/api/books/[id]/keywords/__tests__/filter-route.test.ts`.
2. Mock Supabase queries to return:
   - A mix of `active`, `paused`, `rejected`, and `archived` keyword rows.
   - Category values including `"comp-names"` and non-`"comp-names"`.
3. Mock `rankKeywordsWithAi` to return a controlled set of scores and `category` values.
4. Assert that the route:
   - Marks AI-ranked keywords correctly (`aiRanked: true` in the JSON response).
   - Pauses keywords that the AI explicitly drops by assigning `status = "paused"` and `filter = "aiRelevance"`.
   - Leaves human-negatives untouched (statuses outside `REFILTERABLE_STATUSES`).
   - Computes `pausedByAi` correctly from outcomes.

### 1.3 Competitor filter tests

**Goal:** Verify the competitor ASIN filter pipeline, including AI pause behaviour using `notes`.

1. Create `app/api/books/[id]/competitors/__tests__/filter-route.test.ts`.
2. Mock Supabase to return competitor rows with:
   - Valid and invalid ASINs, including one matching the book’s own ASIN.
   - `notes` set to realistic titles/blurbs.
3. Mock `rankKeywordsWithAi` so that some ASIN notes receive low scores (< `AI_PAUSE_SCORE_THRESHOLD`).
4. Assert that the route:
   - Rejects malformed ASINs with `filter = "asinFormat"`.
   - Rejects self-ASINs with `filter = "selfAsin"`.
   - Pauses low-scoring ASINs with `filter = "aiRelevance"` and an appropriate reason.
   - Returns `{ aiRanked: true, examined, changed }` with correct counts.

---

## 2. Factor large API routes into helpers

**Goal:** Keep each route focused and readable by extracting reusable helper functions.

### 2.1 Create helper modules

1. Add a new file `lib/pipelines/keywordGenerate.ts` that exports functions like:
   - `buildSnapshotCandidates(snapshot)` – moved from `keywords/generate`.
   - `buildLiveKeywordCandidates(snapshot, config)` – wraps Ads API, autocomplete, SerpApi, persona LLM, Groq persona, Decodo.
   - `applyKeywordFiltersAndAllowlist(candidates, filterContext, supabase, user)` – wraps filter pipeline + allowlist overrides.
2. Similarly, add `lib/pipelines/competitorGenerate.ts` with:
   - `buildCompetitorCandidates(snapshot, existingAsins)` – covers snapshot competitors, compAsins, frequently bought together, compare with similar, plus live sources.
3. Add `lib/pipelines/competitorFilter.ts` with:
   - `runCompetitorHeuristicPass(asins, ownAsin)`.
   - `runCompetitorAiPass(asins, snapshot, genreSeedTerms)`.

### 2.2 Refactor routes to use helpers

1. In `keywords/generate/route.ts`, replace inline logic with calls to the new helper functions:
   - Read snapshot and request body.
   - Call `buildSnapshotCandidates` and `buildLiveKeywordCandidates`.
   - Call AI ranking and filter helpers.
   - Upsert rows via a small `saveKeywordRows` helper.
2. In `competitors/generate/route.ts`, call `buildCompetitorCandidates` instead of maintaining a local `candidates` map.
3. In `keywords/filter` and `competitors/filter`, call dedicated filter helpers and keep the route focused on:
   - Input validation
   - Supabase wiring
   - Returning a structured JSON response.

---

## 3. Make AI relevance configurable per book/user

**Goal:** Allow AI relevance passes to be enabled/disabled per book or per user, instead of being globally controlled by environment keys.

### 3.1 Extend database schema

1. Add a boolean column to `books` (or a user settings table), e.g. `ai_relevance_enabled` (default `true`).
2. Add a migration file in your SQL folder (e.g. `sql/XX-ai-relevance-flag.sql`) to add this column.
3. Update Supabase types so `loaded.book.ai_relevance_enabled` is available in routes.

### 3.2 Update configuration logic

1. In `lib/aiRanker.ts`, leave `isAiRankingConfigured()` as the environment-level capability check.
2. In routes, gate the AI passes on both environment and book/user settings, for example:
   - In `keywords/filter` and `keywords/generate`, only call AI ranking when `isAiRankingConfigured()` **and** `book.ai_relevance_enabled` is `true`.
   - In `competitors/filter`, similarly check `book.ai_relevance_enabled` before running the AI pass.
3. Add a small UI setting (later) so users can toggle AI relevance per book or globally.

---

## 4. Reliability and performance improvements

### 4.1 Add basic rate limits / backoff for external APIs

**Goal:** Make generate routes resilient to external API throttling.

1. Create `lib/externalSourceLimiter.ts` exporting utilities like:
   - `withRateLimit(label, fn)` – wraps a source call with simple in-memory rate tracking.
   - `withBackoff(label, fn)` – retries the call with exponential backoff on transient errors.
2. Wrap calls to:
   - Ads API (`getAdsApiKeywordRecommendations`).
   - Autocomplete engines.
   - SerpApi (`getSerpApiKeywordCandidates`).
   - Decodo (`fetchDecodoKeywordRows`).
3. Ensure failures degrade to empty candidate lists rather than throwing, preserving the existing “fail soft” behaviour.

### 4.2 Consider background jobs for heavy operations

**Goal:** Keep UI-triggered requests fast by offloading heavy generate/filter operations.

1. Define a job payload interface, e.g. `KeywordGenerateJob` and `CompetitorGenerateJob` in `lib/jobs/types.ts`.
2. Introduce a queue using your preferred mechanism (Supabase cron, external worker, or a simple table with polling).
3. Change `keywords/generate` and `competitors/generate` routes to:
   - Enqueue jobs and return a “job accepted” response.
   - Provide a status route (e.g. `/api/books/[id]/keywords/generate/status`) that clients can poll.
4. Move the actual generation logic from API routes into worker functions that reuse the pipeline helpers from section 2.

---

## 5. Type-safety and configuration validation

### 5.1 Remove `as any` and tighten unions

1. In `lib/groqKeywordSource.ts`, replace `sources: ["groq-persona" as any]` with:
   - Ensure `"groq-persona"` is part of the `KeywordSource` union in `lib/types.ts` (already partially added).
   - Use `sources: ["groq-persona"]` with proper typing.
2. Ensure all source strings used across the app (`"ads-api"`, `"persona-llm"`, `"groq-persona"`, `"auto-crawl"`, etc.) are declared once in a shared union or constants file.

### 5.2 Configuration validator at startup

**Goal:** Fail fast when environment variables are misconfigured.

1. Add `lib/config.ts` that:
   - Reads `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, Ads API credentials, SerpApi keys, etc.
   - Validates combinations (e.g. marketplace support, missing required pairs).
   - Exposes a `validateConfig()` function.
2. Call `validateConfig()` early in the app (e.g. from `app/layout.tsx` or server entry) so misconfiguration triggers a clear error rather than subtle runtime failures inside routes.

---

## 6. Logging and diagnostics

### 6.1 Structured logging utility

1. Create `lib/logger.ts` that exports:
   - `logInfo(context, message, extra?)`.
   - `logWarn(context, message, extra?)`.
   - `logError(context, message, extra?)`.
2. Use a context object that includes `bookId`, `userId`, `route`, `source`, and optional timing.
3. Replace `console.error` / `console.warn` in:
   - `lib/aiRanker.ts`.
   - `lib/groqClient.ts`.
   - API routes for keywords and competitors.
4. Keep the logger implementation simple (console-based) but structured, so you can later plug in external logging (e.g. Logtail, Datadog).

### 6.2 Optional diagnostic info in responses

1. Extend response shapes from `keywords/filter` and `competitors/filter` to include a `diagnostics` object when a `debug` flag is present in the query string or request body, e.g.:
   - `diagnostics: { contributingSources, filteredCounts, aiRanked, pausedByAi, archivedByCap }`.
2. Ensure diagnostics are omitted by default to keep payloads small.

---

## 7. Documentation

### 7.1 AI behaviour and overrides

**Goal:** Make AI relevance behaviour obvious to future developers and users.

1. Add a markdown doc `docs/AI-RANKING-AND-FILTERING.md` describing:
   - When AI ranking runs (environment + book/user flags).
   - How `category` values (`"tropes"`, `"comp-names"`, `"drop"`) are used.
   - How `aiRelevance` filters behave for keywords and competitor ASINs.
   - How users can override AI decisions (allowlist, manual negatives, status changes).
2. Link this doc from any internal README or developer setup docs.

---

## 8. How to use this spec with Claude Code

1. Commit this file to the repo under `docs/CLAUDE-CODE-IMPROVEMENTS.md`.
2. In Claude Code, open the repository and use a prompt like:

   > Read `docs/CLAUDE-CODE-IMPROVEMENTS.md` end-to-end. Implement the improvements described there in small, focused pull requests. Start with the test suite in section 1, then the pipeline helpers in section 2, then configuration and logging in sections 3–6. Keep all changes backwards-compatible with the existing keyword and competitor flows.

3. Review the generated PRs and merge them incrementally, verifying that AI behaviour and diagnostics match the expectations in this spec.
