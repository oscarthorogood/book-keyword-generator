# Claude Code: Implement Competitor ASIN System

This spec tells Claude Code exactly how to implement the competitor‑ASIN subsystem, reusing the existing keyword UI/UX and pipelines in `book-keyword-generator`.

## Goals

- Add a **competitor ASIN + competitor keyword** subsystem that:
  - Uses separate database tables from the main keyword system.
  - Is visible through **the same UI layout** as keywords (side menu + per‑book page).
  - Has a **toggle on the book page** between "Keywords" and "Competitors".
  - Reuses the same filtering, cap‑and‑rank, and export behaviour as the existing keyword views.
- Make the implementation safe and incremental:
  - Do not break current keyword generation or UI.
  - Keep functions small and well‑tested.

## Files to Inspect First

Claude should start by reading these files carefully:

- `app/layout.tsx` — global layout, sidebar, and navigation.
- `app/books/page.tsx` — books list view.
- `app/books/[id]/page.tsx` — single book page where keywords are displayed.
- `app/keywords/page.tsx` — global keyword view.
- `lib/reverseAsin.ts` — current reverse‑ASIN import and `KeywordCandidate` construction.
- `lib/manualCompetitors.ts` — mapping of book ASINs to manually curated competitor authors/titles.
- `lib/keywordFilters.ts` and `lib/keywordFilterConfig.ts` — keyword filters and configuration.
- `lib/keywordCapAndRank.ts` — keyword slot allocation and ranking logic.
- `lib/types.ts` — shared types for keywords and related entities.
- Any existing SQL/schema files under `sql/` and database helpers under `lib/supabaseServer.ts` / `lib/supabaseAdmin.ts`.

Do **not** edit any file before reading it end‑to‑end.

## Step 1: Database Schema for Competitors

Create new tables (or extend existing schema) for competitors. Use the same conventions as the existing SQL/schema files.

### 1.1 Competitor ASIN table

Add a table, e.g. `competitor_asins`, with at least:

- `id` (primary key).
- `book_id` or `book_asin` (foreign key into the books table or main listing record; match existing conventions).
- `competitor_asin` (string).
- `source` (string, e.g. `"manual"`, `"kdpradar"`, `"datadive"`, `"helium10"`).
- `notes` (text, optional).
- `created_at` / `updated_at` timestamps.

Responsibilities:

- Store the set of competitor ASINs attached to each book.
- Allow multiple competitors per book.

### 1.2 Competitor keyword table

Add a table, e.g. `competitor_keywords`, with at least:

- `id` (primary key).
- `book_id` or `book_asin` (to link back to primary book).
- `competitor_asin` (string, to know which ASIN the keyword came from).
- `text` (normalized keyword string, same style as `KeywordCandidate.text`).
- `volume` (estimated monthly search volume, numeric).
- `rank` (organic rank for that competitor ASIN, numeric).
- `competitor_count` (number of different competitor ASINs where this term appears; initially `1`, later aggregated).
- `mean_rank` (average rank across ASINs in which this term appears; can be null for single‑ASIN entries).
- `category` (string, mirroring categories like `"competing-authors"`, `"comp-titles"`, `"sub-genre"`, `"comp-keyword-core"`).
- `intent_segment` (string, e.g. `"comp-author"`, `"comp-title"`, `"genre-core"`, `"comp-multi-asin"`).
- `match_type` (string, e.g. `"exact"`, `"phrase"`, `"broad"`).
- `specificity` (numeric score, same scale as existing `KeywordCandidate.specificity`).
- `created_at` / `updated_at` timestamps.

Responsibilities:

- Persist the competitor‑derived keyword candidates for each book.
- Mirror the important fields from `KeywordCandidate` so the UI and cap‑and‑rank logic can treat competitor keywords like normal keywords.

### 1.3 DB helpers

Update or create helpers in `lib/supabaseServer.ts` / `lib/supabaseAdmin.ts` to:

- Fetch competitor ASINs for a given book.
- Insert/update/delete competitor ASINs.
- Fetch competitor keywords for a given book (with optional filters for category, match type, etc.).
- Insert/update/delete competitor keywords.

Keep functions small and typed; reuse existing patterns from keyword‑related DB helpers.

## Step 2: APIs for Competitors

Add API routes under `app/api` to manage competitor data.

### 2.1 Competitor ASIN CRUD

Create an API route like `app/api/books/[id]/competitors/route.ts` (or follow existing REST patterns) that supports:

- `GET` — list competitor ASINs for the book.
- `POST` — add a competitor ASIN (body includes `competitor_asin`, `source`, `notes`).
- `DELETE` — remove a competitor ASIN.

Enforce authentication and authorization consistent with the existing keyword/book APIs.

### 2.2 Competitor keyword listing

Create an API route like `app/api/books/[id]/competitor-keywords/route.ts` that supports:

- `GET` — list competitor keywords for the book, optionally filtered by:
  - `category` (e.g. `comp-keyword-core`, `comp-titles`, etc.).
  - `matchType`.
  - `minVolume`, `maxRank`, `minCompetitorCount`.

This route will be used by the UI to display competitor keywords in the same format as normal keywords.

### 2.3 Import endpoints (optional)

Optionally add endpoints to accept reverse‑ASIN CSV uploads for a given book:

- `POST app/api/books/[id]/reverse-asin-import` — accepts JSON representing parsed rows or a file upload, then writes to `competitor_keywords`.

You can reuse `parseReverseAsinRows` from `lib/reverseAsin.ts` inside these handlers.

## Step 3: Extending `lib/reverseAsin.ts` for Multi‑ASIN

Modify `lib/reverseAsin.ts` to support multi‑ASIN aggregation and competitor keyword persistence.

### 3.1 Tool‑agnostic parsing

Add specific parsers that map different CSV formats into `ReverseAsinRow`:

- Functions like:
  - `parseHelium10Rows(rawRows: Array<Record<string, unknown>>): ReverseAsinRow[]`
  - `parseSellerSpriteRows(...)`
  - `parseKdpradarRows(...)`
  - `parseDatadiveRows(...)`

Each parser should:

- Pick tool‑specific columns for text, volume, and rank.
- Normalize text using `normalize` from `keywordMerge`.

Then either:

- Use a wrapper `parseReverseAsinRows(rawRows, tool: "helium10" | "sellersprite" | ...)` or
- Keep tool‑specific functions and call them from the import endpoints.

### 3.2 Multi‑ASIN aggregation

Add a function like:

```ts
export interface ReverseAsinWithAsin extends ReverseAsinRow {
  asin: string;
}

export function aggregateReverseAsinRows(
  rows: ReverseAsinWithAsin[],
  options?: {
    minVolume?: number;
    maxRank?: number;
    minCompetitorCount?: number;
  }
): ReverseAsinRow[] {
  // Implementation: group by text, compute volume, mean rank, competitorCount
}
```

Behaviour:

- Group rows by `text`.
- Compute:
  - `competitorCount` = number of distinct `asin`s.
  - `mean_rank` = average `rank` across those ASINs.
  - `volume` = can be max, mean, or sum (choose a sensible default; max is often fine).
- Apply thresholds:
  - `minVolume` (default higher than existing `MIN_VOLUME_FOR_KEEP`, e.g. 100–300).
  - `maxRank` (default similar or stricter than `MAX_RANK_FOR_KEEP`).
  - `minCompetitorCount` (default `2` or `3`).

Return aggregated `ReverseAsinRow[]` to feed into `buildReverseAsinCandidates`.

### 3.3 Building competitor candidates and storing them

Add a function like:

```ts
export function buildAndStoreCompetitorCandidates(
  book: { id: string; author?: string; asin?: string },
  rows: ReverseAsinWithAsin[],
  extraAuthors: string[] = [],
  extraTitles: string[] = []
): Promise<void> {
  // 1) Aggregate rows
  // 2) Call buildReverseAsinCandidates
  // 3) Write to competitor_keywords table via Supabase
}
```

Notes:

- Use the existing `buildReverseAsinCandidates` logic for classification into `competing-authors`, `comp-titles`, `sub-genre`.
- When writing to `competitor_keywords`:
  - Store `competitorCount` and `mean_rank` as appropriate.
  - Set `category` / `intent_segment` fields consistent with the candidate.
  - Avoid duplicates (by text+book+competitorAsin) using upserts or pre‑check queries.

## Step 4: Integrate with Filters and Cap‑and‑Rank

Extend filter and ranking logic so competitor keywords are treated consistently.

### 4.1 Filters

In `lib/keywordFilters.ts` and `lib/keywordFilterConfig.ts`:

- Ensure the same validation rules (e.g. negative keyword checks, media/author disambiguation) apply to competitor keywords.
- If filters currently expect `sources: string[]`, make sure `"reverse-asin"` and any competitor‑specific tags are supported.

If needed, add configuration entries for:

- Minimum volume and maximum rank thresholds for competitor keywords.
- Behaviour when competitor data is missing (no crash; just skip competitor‑based slots).

### 4.2 Cap‑and‑rank integration

In `lib/keywordCapAndRank.ts`:

- Identify where keywords are grouped by category/intent (e.g. `genre-core`, `comp-author`, etc.).
- Add explicit handling for competitor keywords, for example:

  - Reserve a small number of **exact‑match slots** for multi‑ASIN competitor core terms.
  - Reserve some **phrase/broad slots** for single‑ASIN competitor terms.
  - Limit the total number of competitor‑derived slots so they don’t crowd out other sources.

Implementation idea:

- If the function currently accepts a flat array of `KeywordCandidate`, consider adding a step that:
  - Merges "normal" candidates and competitor candidates.
  - Groups by `intentSegment`/`category`.
  - Applies per‑segment caps.

Keep changes minimal and well‑commented so future maintenance is easy.

## Step 5: UI — Global Navigation

Update the app layout and navigation to expose competitors.

### 5.1 Sidebar entry

In `app/layout.tsx` (or wherever the sidebar is defined):

- Add a new navigation item, e.g. "Competitors".
- Route it to either:
  - A new global view: `/competitors`, or
  - The books list with query param (e.g. `/books?view=competitors`).

Follow existing styling and components; do not introduce new design systems.

### 5.2 Global competitors page

Create a route `app/competitors/page.tsx` that:

- Uses the same layout components as `app/keywords/page.tsx`.
- Displays books and high‑level competitor stats (e.g. number of competitor ASINs per book, total competitor keywords).
- Links through to individual book pages with the competitors tab pre‑selected.

You can factor out shared components from `app/keywords/page.tsx` and reuse them here.

## Step 6: UI — Book Page Toggle

Modify `app/books/[id]/page.tsx` to support a toggle between keywords and competitors.

### 6.1 Extract existing keyword panel

- Identify the part of the book page that displays the book’s keywords and actions (export, filters, etc.).
- Extract this into a reusable component, for example:

  ```tsx
  function BookKeywordPanel(props: { bookId: string; mode: "keywords" | "competitors" }) {
    // Fetch data via mode
    // Render table/list and actions
  }
  ```

- For `mode = "keywords"`, use existing queries/endpoints.
- For `mode = "competitors"`, call the new competitor endpoints.

### 6.2 Add the toggle UI

At the top of the book page, add a simple tab/toggle component:

- Two tabs: `Keywords` and `Competitors`.
- When `Keywords` is active:
  - Render `<BookKeywordPanel bookId={id} mode="keywords" />`.
- When `Competitors` is active:
  - Render `<BookKeywordPanel bookId={id} mode="competitors" />`.

Ensure:

- The rest of the page (book metadata, quality scores, etc.) remains unchanged.
- The toggle preserves URL state, if your design does that elsewhere (e.g. query params like `?view=competitors`).

### 6.3 Behaviours shared between modes

Make sure `BookKeywordPanel` supports the same behaviours in both modes:

- Sorting and filtering by category/match type/specificity.
- Copy/export actions (e.g. export to CSV, copy to clipboard for ads).
- Any per‑keyword actions (e.g. marking as negative, pinning, etc.).

Only the data source (keywords vs competitor_keywords) and any competitor‑specific fields should differ.

## Step 7: Tests

Add tests around the new functionality. Use existing test patterns (under `tests/`) as guidance.

### 7.1 Reverse‑ASIN aggregation

- Unit tests for `aggregateReverseAsinRows`:
  - Aggregates rows from multiple ASINs correctly.
  - Computes `competitorCount` and `mean_rank` as expected.
  - Applies thresholds and drops rows that don’t meet criteria.

### 7.2 DB and API

- Tests for competitor DB helpers (if the project has integration tests).
- Tests for competitor API routes to ensure:
  - Correct data shapes.
  - Proper auth/permissions.

### 7.3 UI

- Component tests for the book page toggle:
  - Renders both tabs.
  - Switches mode correctly.
  - Calls the right data loaders based on mode.

Keep tests focused and deterministic; use small fixtures rather than large datasets.

## Step 8: Safety and Constraints

- Do not rename or remove existing keyword tables, columns, or APIs unless absolutely necessary.
- Do not introduce breaking changes to current keyword workflows.
- If you need to change shared types or helpers, keep the updates backwards‑compatible and update all call sites.
- Prefer new, well‑named functions over large modifications to existing ones.

## Implementation Order

Implement in this order:

1. Database schema + Supabase helpers for competitor ASINs and competitor keywords.
2. API routes for competitor ASINs and competitor keywords.
3. Extensions to `lib/reverseAsin.ts` for tool‑agnostic parsing and multi‑ASIN aggregation.
4. Writing competitor candidates into the new tables.
5. Filter and cap‑and‑rank integration for competitor keywords.
6. Sidebar navigation and global competitors page.
7. Book page toggle and `BookKeywordPanel` refactor.
8. Tests for aggregation, DB/API, and UI.

Only when all steps are complete and tests pass should you consider the competitor subsystem implemented.