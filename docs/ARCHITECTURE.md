# Amazon Ads Assistant — Architecture & Implementation Guide

**Last updated:** 2026-08-10  
**Current version:** Phase 1 (Generator only, no live account connection)

---

## 1. System Overview

**Language/Framework:** TypeScript + Next.js 16 (React 19)  
**Persistence:** Supabase (PostgreSQL) for auth + user data  
**Output:** Amazon Ads Sponsored Products bulksheet (CSV — see the reconciliation note below; `exceljs` is a dependency but unused in the current export path)

**Current scope:** One-shot campaign generator. User inputs book metadata (ASIN, title, author, etc.) → system scrapes Amazon + external sources for keyword ideas → outputs a bulksheet ready to upload to Amazon Ads.

**Roadmap scope:** Evolve into both generator + live campaign manager (Phase 3 requires Amazon Ads API access).

---

## 2. Data Flow: How a Bulksheet Is Generated

> **Reconciliation note (§0.1, 2026-08):** This section originally described a
> single-page campaign wizard posting to `app/api/generate/route.ts`. That
> route does not exist in the current tree and the wizard fields below
> (start/end dates, creator initials) are historical — code wins over docs.
> The live app is a book-library flow: books are created via
> `POST /api/books/create`, and keyword generation is per-book at
> `POST /api/books/[id]/keywords/generate`, with `GET .../keywords`,
> `POST .../keywords/filter`, and `GET .../keywords/export` as the
> supporting routes. See the README's "How it works" section for the
> current, accurate flow. The rest of this section (steps 2–6) still
> reflects the real pipeline shape; only the entry point and export format
> below are corrected.

### 2.1 Entry Point: `app/api/books/[id]/keywords/generate/route.ts`

`POST /api/books/[id]/keywords/generate` regenerates keywords for an
already-created book, using the snapshot captured when the book was added
(see `lib/bookSnapshot.ts`) rather than accepting campaign settings in the
request body. There is no start/end-date or creator-initials input in the
current flow — those were wizard-era fields that did not survive into the
book-library UI.

### 2.2 Keyword Generation Pipeline

**High-level flow:**

```
1. Scrape sources (multiple in parallel):
   - Amazon product page (title, categories, "customers also bought" ASINs)
   - Amazon autocomplete (title + author + genre modifiers as seeds)
   - Author catalog (other books by this author)
   - Goodreads tags
   - Google/YouTube/DuckDuckGo autocomplete
   - Wikipedia / Wikidata / Library of Congress categories
   - Customer Q&A and reviews

2. Merge all candidates:
   - Deduplicate across sources
   - Tag with source + category (trope, comp author, etc.)

3. Score & filter:
   - Heuristic scoring (source quality, frequency, length, word count)
   - AI ranking (if configured, optional)
   - Quality adjustments (generic terms, format-only keywords, length)
   - Validation gate (NEW): ASIN format, malformed keywords, hallucinations, etc.

4. Split into ad groups:
   - Tropes & Themes (~100-120 keywords)
   - Comp Authors & Titles (~20-30 keywords)
   - Product Targeting (~10-12 ASINs + optional expanded targeting)

5. Tier bids:
   - Base bid derived from bid economics or manual default
   - Ad group multipliers (tropes: 0.75x, comp: 1.0x, product: 0.9x)
   - Match type multipliers (Broad: 0.7x, Phrase: 1.0x, Exact: 1.2x)

6. Export (`lib/bulksheet.ts`, `GET /api/books/[id]/keywords/export`):
   - Build a CSV with Campaign / Ad Group / Keyword / Product Targeting rows
     (`buildBulksheetRows` + `toCsv`/`buildBulksheetCsv`)
   - **Known gap (§23.2):** the current CSV is a review sheet, not an
     uploadable Amazon SP bulk file — it has no Product Ad row, no SKU/ASIN
     column, and custom columns Amazon's bulk template doesn't expect. See
     the Enhancements spec §23.2 for the fix (emit the official bulk
     template, or ship a `*-review.csv` + `*-upload.xlsx` pair).
   - Negative keywords starter list (`lib/negativeKeywords.ts`), currently
     only attached to the descriptive campaign (§23.7 gap)
```

### 2.3 File Organization by Responsibility

**Scraping & Source Data:**
- `lib/scrape.ts` — Amazon product page, autocomplete (Amazon/Google/YouTube/DuckDuckGo), Q&A, reviews, author catalog
- `lib/goodreads.ts` — Goodreads tag scraping
- `lib/bookMetadata.ts` — Wikipedia, Wikidata, Library of Congress lookups
- `lib/firecrawl.ts` — Fallback web scraping via Firecrawl API

**Keyword Candidate Building & Merging:**
- `lib/keywordMerge.ts` — Build candidates from each source, merge, dedupe, score
- `lib/keywordCategories.ts` — 20-category semantic taxonomy (genre, trope, mood, format, etc.)
- `lib/reviewMining.ts` — Extract recurring phrases from review snippets
- `lib/textExtract.ts` — General text extraction utilities

**Filtering & Validation (NEW):**
- `lib/keywordValidation.ts` — Quality checks, generic/format-only filtering, critical bug rejection
- `lib/asinValidation.ts` — ASIN/ISBN format + placeholder validation
- `lib/compDataValidation.ts` — Hallucination detection for thin comp data

**Bidding:**
- `lib/bidding.ts` — RRP-derived bid economics, match-type multipliers, final bid calculation

**Campaign Structure & Export:**
- `lib/naming.ts` — Campaign/ad group name building + parsing
- `lib/bulksheet.ts` — Amazon Ads bulk-upload row construction + CSV export
- `lib/productTargets.ts` — ASIN/brand targeting candidates, ranked by BSR + review count
- `lib/negativeKeywords.ts` — Negative keyword candidates from pipeline rejections

**Supplementary:**
- `lib/amazonAds.ts` — Amazon Ads API client (suggested bids, etc.) — stub, not live yet
- `lib/aiRanker.ts` — Optional LLM ranking (Claude API) — improves sort order
- `lib/synonyms.ts` — Allowlist-only genre synonym expansion
- `lib/isbn.ts` — ISBN/ASIN normalization

**Relevance filtering (post-generation):**
- `lib/keywordFilters.ts` — The ordered filter pipeline (reject / pause / pass)
- `lib/keywordAnchors.ts` — Per-book relevance anchors derived from the scrape
- `lib/keywordFilterConfig.ts` — Tunable blocklists/allowlists

**Listing capture:**
- `lib/listingRecord.ts` — `ListingRecord` schema, validation, per-field coverage
- `lib/listingMetadata.ts` — HTML-level extraction (meta keywords, slug, formats, variations)
- `lib/listingKeywords.ts` — Field-weighted n-gram mining over a listing record
- `lib/fetchLog.ts` — Fetch audit log, per-host rate limiting, CAPTCHA circuit breaker

**UI Layer:**
- `app/page.tsx` — Main form (book metadata, keyword preferences, bid settings)
- `components/*.tsx` — UI components (header, login, access manager)

**Auth & Persistence:**
- `lib/supabaseServer.ts` — Supabase auth + user context
- `lib/supabaseStorage.ts` — Archive generated bulksheets

---

## 3. Data Structures

### 3.1 Core Types (`lib/types.ts`)

```typescript
interface GenerateRequest {
  asin: string;
  marketplace: Marketplace; // US, UK, CA, etc.
  creatorInitials: string; // 2-char code for campaign name
  authorName: string;
  bookTitle: string;
  seriesName?: string;
  seriesOrder?: number; // Book position in series
  seriesTotal?: number; // Total books in series
  dailyBudget: number;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // Optional, max 1 year duration
  variant: number; // Campaign variant (1, 2, 3, ...)
  matchTypes: MatchType[]; // broad, phrase, exact
  bidEconomics?: BidEconomics; // RRP + target ACOS
  defaultBid?: number; // Manual bid override
  sources: KeywordSource[]; // Which sources to use
  keywordTypes: KeywordGroupType[]; // Which ad group types
  keywordCategories: KeywordCategory[]; // 20-category semantic taxonomy
  keyTropes: string[]; // User-supplied character/plot tropes
  manualKeywords: string[]; // User-typed keywords
  knownTags?: string[]; // User-supplied tags
}

interface KeywordCandidate {
  text: string;
  sources: KeywordSource[];
  score?: number;
  suggestedBid?: number;
  category?: KeywordCategory;
}

interface ProductTargetCandidate {
  asin: string;
  sources: KeywordSource[];
  suggestedBid?: number;
}

interface ProductPageData {
  title?: string;
  author?: string;
  asin?: string;
  isbn10?: string;
  isbn13?: string;
  price?: number;
  rating?: number;
  reviewCount?: number;
  categories: string[]; // Browse-node breadcrumb trail
  categoryPath: string[]; // Ordered: Books → Genre → Subgenre
  compAsins: string[]; // "Customers also bought" ASINs
  compTitles: string[]; // Extracted titles from product tiles
  bulletPoints: string[];
  description?: string;
  reviewSnippets: string[];
  // ... plus 15+ other fields
}

interface BulksheetInput {
  campaignName: string;
  asin: string;
  author?: string;
  bookTitle?: string;
  seriesName?: string;
  seriesOrder?: number;
  seriesTotal?: number;
  dailyBudget: number;
  startDate: string;
  endDate?: string;
  baseBid: number;
  adGroups: SpmAdGroup[];
  includeMetadataSheet?: boolean;
}
```

---

## 4. Current Generator Bugs & Fixes (Phase 1)

### 4.1 Completed Fixes

| Bug | File | Fix | Status |
|-----|------|-----|--------|
| 1.1 Invalid ASIN format | `lib/asinValidation.ts` | `isValidAsinOrIsbn()` validates B0 + 8 alphanumeric OR ISBN | ✅ |
| 1.2 Non-book products in comp list | `lib/keywordValidation.ts` | `containsNonBookProductTerm()` denylist | ✅ |
| 1.3 "book cover X, kindle unlimited" | `lib/keywordValidation.ts` | `isMalformedProductTile()` pattern match | ✅ |
| 1.4 Category-label templating | `lib/keywordValidation.ts` | `isCategoryLabelMisapplication()`, `hasRepeatedWords()` | ✅ |
| 1.5 Entity hallucination | `lib/compDataValidation.ts` | `assessCompDataHealth()`, `filterHallucinatedCompKeywords()` | ✅ |
| 1.6 Deterministic generation | `lib/idGeneration.ts` | (NOT YET: needs stable author-code lookup + caching) | ⏳ |

### 4.2 Integration Points

All validation runs through `getKeywordQualityAdjustment()` in `lib/keywordValidation.ts`:
- Applied in `rebalanceKeywordBudget()` before final keyword selection
- Critical bugs (penalty ≤ -50) are rejected immediately
- Soft penalties reduce score/bid

ASIN validation happens at two points:
- `buildProductTargetCandidates()` in `lib/productTargets.ts`
- `buildBulksheet()` in `lib/bulksheet.ts` before writing Product Targeting rows

---

## 5. Persistence & Data Models

### 5.1 Current (One-shot Generator Only)

**Auth:** Supabase Auth (magic link)  
**User context:** Stored in `lib/supabaseServer.ts` (current user from session)  
**Generated bulksheets:** Archived to Supabase Storage (optional, user-initiated)

**No persistence of:**
- Generated keywords per ASIN (re-runs generate fresh)
- Author codes (derived per run, not cached)
- Bid ramp-up rules
- Decision logs
- Live campaign state

### 5.2 New Data Models Needed (Phase 2-3)

> **Status check (§0.1):** none of the tables below exist yet — there is no
> `lib/keywordCache.ts`, `author_code`, or `decision_log` in the current
> tree, and generate runs are not cached or deterministic. Treat every
> schema in this section as proposed, not implemented; reuse these
> names/shapes when a section of the Enhancements spec needs one of them
> instead of inventing a parallel table.

```sql
-- Phase 1.6: Deterministic generation
CREATE TABLE author_code (
  id UUID PRIMARY KEY,
  author_name TEXT UNIQUE,
  code CHAR(2),
  created_at TIMESTAMP DEFAULT now()
);

CREATE TABLE keyword_cache (
  id UUID PRIMARY KEY,
  asin TEXT,
  marketplace VARCHAR(2),
  generation_fingerprint TEXT, -- Hash of input params
  keywords JSONB, -- Cached validated keyword set
  cached_at TIMESTAMP DEFAULT now(),
  expires_at TIMESTAMP
);

-- Phase 2: Decision logging
CREATE TABLE decision_log (
  id UUID PRIMARY KEY,
  asin TEXT,
  generation_run_id UUID,
  decision_type VARCHAR(50), -- 'rejected', 'kept', 'scored', 'bid_set'
  keyword_text TEXT,
  reason TEXT,
  score_adjustment DECIMAL,
  created_at TIMESTAMP DEFAULT now()
);

-- Phase 2: Per-book profile settings
CREATE TABLE book_profile (
  id UUID PRIMARY KEY,
  asin TEXT UNIQUE,
  author_id UUID REFERENCES auth.users,
  conservative_mode BOOLEAN DEFAULT true,
  ku_enrolled BOOLEAN DEFAULT false,
  prime_reading_enrolled BOOLEAN DEFAULT false,
  target_acos DECIMAL DEFAULT 2.0,
  target_cvr DECIMAL DEFAULT 0.02,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

-- Phase 3: Live campaign tracking
CREATE TABLE campaign_state (
  id UUID PRIMARY KEY,
  asin TEXT,
  campaign_id TEXT, -- Amazon Ads campaign ID
  campaign_name TEXT,
  state VARCHAR(20), -- 'enabled', 'paused', 'archived'
  daily_budget DECIMAL,
  current_spend DECIMAL,
  impressions BIGINT,
  clicks BIGINT,
  conversions INT,
  spend_this_period DECIMAL,
  synced_at TIMESTAMP,
  created_at TIMESTAMP
);

CREATE TABLE search_term_history (
  id UUID PRIMARY KEY,
  asin TEXT,
  campaign_id TEXT,
  search_term TEXT,
  clicks INT,
  spend DECIMAL,
  conversions INT,
  acos DECIMAL,
  report_date DATE,
  created_at TIMESTAMP
);

-- Phase 3: Action log (every automation decision)
CREATE TABLE action_log (
  id UUID PRIMARY KEY,
  asin TEXT,
  action_type VARCHAR(50), -- 'bid_increase', 'keyword_add', 'keyword_negate', 'pause'
  target_type VARCHAR(20), -- 'keyword', 'product_target', 'campaign'
  target_id TEXT,
  before_state JSONB,
  after_state JSONB,
  reason TEXT,
  executed BOOLEAN DEFAULT false,
  reversal_path TEXT,
  created_at TIMESTAMP
);
```

---

## 6. External Dependencies & APIs

| Service | Used for | Configured via | Status |
|---------|----------|-----------------|--------|
| Amazon (product page scraping) | Product metadata, "customers also bought" | ScraperAPI proxy (optional) | Working |
| Amazon autocomplete | Keyword ideas | Unofficial JSON endpoint | Working |
| Google Autocomplete | Keyword ideas | Google Suggest API | Working |
| YouTube Autocomplete | Keyword ideas | YouTube Suggest API | Working |
| DuckDuckGo Autocomplete | Keyword ideas | DuckDuckGo JSON API | Working |
| Goodreads | Reader tags | Web scraping (no official API) | Working |
| Wikipedia | Category info | Wikipedia API | Working |
| Wikidata | Genre/work data | Wikidata JSON API | Working |
| Library of Congress | Subject classifications | LOC SRU API | Working |
| SerpApi Amazon Search | Related searches, competitor titles/authors | SerpApi (`engine=amazon`) | Optional (key) |
| SerpApi Amazon Autocomplete | Search-bar suggestions | SerpApi (`engine=amazon_autocomplete`) | Optional (key) |
| SerpApi Amazon Product | ASIN record, bought-together crawl | SerpApi (`engine=amazon_product`) | Optional (key) |
| Google Gemini (`gemini-2.0-flash`) | Keyword ranking (optional) | `GEMINI_API_KEY` in `lib/aiRanker.ts` — **not** Claude, correcting the prior entry here | Configured (optional) |
| **Amazon Ads API** | **Suggested bids, campaign state** | **⏳ NOT YET** | ⏳ Needed for Phase 3 |
| Firecrawl | Fallback web scraping | Firecrawl API (optional) | Fallback |

**Phase 3 blocker:** Amazon Ads API requires developer application approval (LWA client ID + secret). User must register with Amazon and get approved before Phase 3 work begins.

---

## 7. Build Order & Integration Points

### Phase 1 (Critical bugs — now)
- ✅ 1.1-1.5: Done
- ⏳ 1.6: Author-code caching + keyword-cache idempotence

### Phase 2 (Generator improvements)
- 2.1: Match-type strategy (default to Phrase only)
- 2.2: Budget-aware keyword capping
- ✅ 2.3: Template library split (Tier A safe / Tier B gated) — implemented as
  the Enhancements spec §3 preset keyword library (`/presets`,
  `sql/10-preset-keywords.sql`, `lib/presetKeywords.ts`)
- 2.4: Access-model cluster (KU/Prime gating)
- 2.5: Expanded comp-title sourcing
- 2.6: Two-tier ASIN targeting (Exact + Expanded)
- 2.7: Intent filter (spoilers, movies, piracy)
- 2.8: Bid ramp-up rules (structured data, not prose)
- 2.9: Decision log (every filter/accept/set decision)
- 2.10: Conservative/aggressive generation profile

**Integration:** All in `app/api/generate/route.ts` and `lib/keywordMerge.ts`

### Phase 3 (Live manager — requires API access)
- 3.1: Data layer (new DB schema)
- 3.2: Keyword harvesting job (weekly)
- 3.3: Keyword negation job (weekly)
- 3.4: Bid nudger (ramp-up rule execution)
- 3.5: Structural/pause job (underperforming targets)
- 3.6: Safety rails (dry-run, explicit apply, hard caps, logging)
- 3.7: Reporting (per-book weekly summary)

**Integration:** New job orchestration layer (cron or background workers), new API endpoints for job management, new DB models above.

---

## 8. Testing Strategy

### Phase 1: Regression Tests
Each bug fix needs a test fixture:
- Invalid ASIN: `asin="CLOVERLEAF"` must be rejected
- "book cover" keyword: `"book cover the inmate: ..., kindle unlimited"` must be rejected
- Category-label: input `category="Kindle Store"` must not produce `"cozy kindle store"`
- Non-book products: `"barclaycard"` in comp list must be filtered out
- Hallucination: book with 1 real comp must not backfill with `"a.a. fair books"`

### Phase 2: Integration Tests
- End-to-end generation with mock data
- Bulksheet output format matches Amazon's schema
- Budget-aware keyword capping produces correct row count
- Conservative/aggressive profiles affect bid/keyword mix

### Phase 3: Live Simulation
- Mock Amazon Ads API responses
- Verify job logic (harvest, negate, bid nudge) against fixtures
- Dry-run mode produces correct proposed changes
- Logging captures every action with reversal path

---

## 9. Deployment & Environment

**Current hosting:** Vercel (Next.js default)  
**Environment variables needed:**
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase auth
- `SCRAPER_PROXY_API_KEY` — Optional ScraperAPI for Amazon scraping (datacenter IP block workaround)
- `GEMINI_API_KEY` — Optional Google Gemini key for keyword ranking (`lib/aiRanker.ts`); was previously and incorrectly documented here as `CLAUDE_API_KEY`
- `FIRECRAWL_API_KEY` — Optional Firecrawl fallback scraping
- ⏳ `AMAZON_ADS_CLIENT_ID`, `AMAZON_ADS_CLIENT_SECRET` — Needed for Phase 3

**Note:** Phase 3 jobs need persistent storage (not Vercel Functions, which timeout after 15 min). Recommend Supabase background jobs, AWS Lambda with SQS, or a separate worker service.

---

## 10. Known Limitations & Future Improvements

- **No deterministic re-runs yet** (1.6): Keyword selection still has LLM/randomness elements
- **No budget auto-scaling** (2.2): Must manually cap keyword rows
- **No real bid optimization** (2.8, 3.4): Bid ramp-up is configurable but not adaptive
- **No Sponsored Brands/Display** (out of scope): Sponsored Products only
- **No portfolio-level optimization**: Per-book campaigns only
- **No dayparting** (Phase 4 out of scope): Same bids 24/7

---

*Last updated: 2026-08-10*  
*Next phase: Complete Phase 1.6, then Phase 2*
