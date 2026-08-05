# Amazon Book Ads Builder

A two-phase Sponsored Products campaign builder for books: launch a cheap Auto
(SPA) campaign to let Amazon's own targeting discover what customers search
for, then harvest its Search Term report into a Manual (SPM) campaign of
exact-match keywords and product targets. A cold-start keyword generator is
still available for going straight to Manual, but the harvest loop is the
intended steady-state workflow — see `AmazonAdsKeywordGeneratorCampaignBuilderLearnings`
for the account analysis this is built from.

Two pages, two API routes, no database — stateless: one request in, one file
out. Gated behind HTTP Basic Auth for private/single-user use.

## How it works

### `/` — Generate (cold start)

- **Auto (SPA):** skips keyword research entirely and just launches the
  campaign, with tiered bids across Amazon's 4 default targeting clauses
  (close-match / loose-match / substitutes / complements). This is the
  cheap discovery step — run it first, let it collect data, then harvest.
- **Manual (SPM):**
  1. Scrapes the book's own Amazon product page for ISBN, "customers also
     bought" comp titles + their ASINs, and category/best-seller placement.
  2. In parallel: calls the Amazon Ads API keyword-recommendations endpoint,
     sweeps Amazon's *and* Google's unofficial autocomplete endpoints across
     dozens of seed phrases (title, format/series-order/recency modifiers,
     title + a–z — see "Keyword generation" below), scrapes categories from a
     few of the comp titles' own product pages, looks up the book in Google
     Books + Open Library for genre/subject data, and scrapes Google Books'
     "About this book" page for its content-derived "Common terms and
     phrases" list.
  3. All sources degrade gracefully — if one fails (no Ads API credentials, a
     blocked scrape, no ISBN match), the app carries on with whatever the
     other sources returned instead of failing the whole request.
  4. Templates genre/subject terms into buyer-intent phrases, plus
     format/series-order/recency modifiers seeded from real search term data.
  5. Merges everything, filters junk (generic terms, scraped-page boilerplate,
     garbled/bot queries), collapses near-duplicates, routes bare-ASIN
     "keywords" to product targeting instead of dropping them, scores each
     surviving keyword by source agreement and specificity, and derives a bid
     from RRP × net margin × target ACOS × conversion rate (or a manual
     override), tiered by match type and confidence.
  6. Writes a Sponsored Products Bulksheet (Campaign / Ad Group / Product Ad /
     Keyword / Product Targeting rows), best-scoring keywords first.

### `/harvest` — Promote/negate from a Search Term report

Upload the Search Term report from a running Auto or Manual campaign:

- Terms with orders at or below the target ACOS get **promoted** to
  exact-match keywords (bare-ASIN terms become product targets instead),
  bid slightly above the CPC that already proved it converts.
- Terms that spent past a click threshold with zero orders get
  **negative-matched**.
- Everything else is left alone (**monitor** / **low-impressions**) rather
  than hand-tuned — most of the long tail is expected to be dead weight (see
  the learnings doc's power-law note), so the loop is built to be cheap and
  automatic, not to optimize every row.
- Garbled/bot queries and scraped-page rating boilerplate are filtered before
  anything reaches the bulksheet.
- Output follows the same naming convention with an incremented **variant**
  number, matching the "duplicate the winner" pattern the downstream
  monitoring tracker already expects (`Copy 1`, `Copy 2`, ...).

## Campaign naming convention

Every campaign this app creates follows:

```
PB_{creator initials}_{ASIN}_{Author}_{Series Name}_{Title}_{Country}_{SPA|SPM}_{variant}
```

e.g. `PB_MO_103671165X_Andrew Raymond_A DC Mairead Maclean Mystery_The Long Isle_UK_SPA_1`

This isn't optional or free-text — it's what lets the downstream monitoring
system parse ASIN and Author back out of the campaign name with a plain
string split, no lookup table needed (`lib/naming.ts`). The generator and
harvester both compute it server-side from structured fields rather than
accepting a free-text campaign name.

## Bid economics

Bids are derived from RRP rather than a flat default, matching the
downstream monitoring tracker's actual profitability math (net margin rate
0.4, i.e. `Net RRP = RRP × 0.4`):

```
maxCpc = (RRP × 0.4) × targetAcos × estConversionRate   (lib/bidding.ts)
```

That CPC ceiling is then tiered down for broader match types
(`MATCH_TYPE_BID_MULTIPLIER`) and for Auto-targeting's more exploratory
clauses (substitutes/complements bid lower than close-match). A manual
Default Bid is still accepted as a fallback when RRP isn't known.

### Keyword generation, in more detail

Everything here is free — no paid keyword APIs — so "effective" comes from
squeezing more signal out of the free sources rather than paying for a
better one:

- **Alphabet-soup autocomplete seeding** (`buildAutocompleteSeeds` in
  `lib/scrape.ts`) — Amazon's autocomplete returns different completions per
  next character, so sweeping `<title> a` through `<title> z` (plus format,
  series-order, and recency/bestseller modifiers — `hardcover`, `books in
  order`, `best sellers`, etc., patterns drawn from a real search term
  report) pulls far more real suggestions out of the same free endpoint than
  just querying the bare title. Capped at 40 seeds, fetched with bounded
  concurrency so it doesn't hammer Amazon or blow a serverless function's
  time budget.
- **One-hop comp-title scraping** (`scrapeRelatedCategories`) — the "customers
  also bought" carousel gives us a few ASINs of directly comparable books; we
  scrape their category placement too, borrowing keywords from books already
  proven to sell to the same readers.
- **Google autocomplete sweep** (`getGoogleAutocompleteKeywordSet` in
  `lib/scrape.ts`) — the same alphabet-soup seeding, but against Google's own
  unofficial search-suggest endpoint instead of Amazon's, to surface what
  readers search for on the wider web (which can differ from Amazon's on-site
  suggestions). Capped shorter than the Amazon sweep so the combined request
  count for one generate call stays bounded.
- **Google Books "Common terms and phrases" scrape**
  (`scrapeGoogleBooksCommonTerms` in `lib/bookMetadata.ts`) — Google Books'
  web page (not the API) sometimes shows a word list it auto-extracts from
  the book's actual text, for titles it has preview/snippet access to. It's
  a content-derived signal nothing else here provides. This scrapes Google's
  web frontend rather than the official API, which is shakier ToS territory
  and its exact page structure wasn't verified against a live page while
  building this (the dev sandbox couldn't reach books.google.com) — the
  parser tries a few plausible DOM shapes and degrades to "no extra terms"
  if none match, but it's worth confirming it actually finds something once
  deployed.
- **Buyer-intent templating** (`buildBuyerIntentCandidates` in
  `lib/keywordMerge.ts`) — crosses the genre/subject terms already extracted
  with generic intent phrasing, plus format/series-order/recency templates
  keyed off author and series name, to generate long-tail candidates for free.
- **Generic-term filtering** — standalone single words like "book", "novel",
  "kindle" are dropped; they're too broad to be worth a keyword slot alone
  even though they're kept as part of a longer phrase.
- **Junk filtering** (`isGarbledText` / `isScrapedBoilerplate` in
  `lib/keywordMerge.ts`) — drops garbled/bot queries (a character-class
  sanity check, not linguistic) and scraped-page artifacts like rating
  widget text (`"4.5 out of 5 stars"`, `"955)"`) that leak in from product
  page scraping. Both were confirmed present in a real production bulksheet.
- **Bare-ASIN routing** (`extractAsinCandidates` in `lib/keywordMerge.ts`,
  `lib/productTargets.ts`) — Auto-targeting's complements/substitutes clauses
  match against other *products*, not text, so raw ASINs sometimes show up
  as "search terms." Those are routed to Product Targeting rows instead of
  being dropped as junk keywords.
- **Near-duplicate collapsing** — a plural/word-order-insensitive signature
  merges near-identical candidates ("wizard school books" / "wizard schools
  book") so budget isn't split across the same idea twice.
- **Confidence scoring + bid tiering** — keywords multiple independent
  sources agree on (and Ads-API-sourced ones, which carry real bid data)
  score highest and keep their bid; single-source speculative terms get a
  discounted bid so testing them risks less spend. Bids are also tiered by
  match type (`MATCH_TYPE_BID_MULTIPLIER` in `lib/bidding.ts` — exact match
  gets the full CPC ceiling, broad the deepest discount). The Bulksheet
  output is sorted best-first.
- **Capped to Amazon's own recommended range** — Amazon's keyword-targeting
  guidance is 25-50 keywords per ad group (`RECOMMENDED_MIN_KEYWORDS` /
  `RECOMMENDED_MAX_KEYWORDS` in `lib/keywordMerge.ts`). The final list is
  truncated to the top 50 best-scoring keywords; if free sources turn up
  fewer than 25, the app still generates the file but flags it in the UI
  rather than padding the ad group with filler.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run dev
```

### Environment variables

See `.env.example`. Required:

- `APP_PASSWORD` — gates the app (HTTP Basic Auth, any username, this password).
- `AMAZON_ADS_CLIENT_ID` / `AMAZON_ADS_CLIENT_SECRET` — from a Login with Amazon
  security profile registered in the [Amazon Ads developer console](https://advertising.amazon.com/API/docs).
- `AMAZON_ADS_REFRESH_TOKEN` — minted once via a manual Login with Amazon OAuth
  consent flow. This app does not do that flow for you — it's a one-time setup
  step outside the app.
- `AMAZON_ADS_PROFILE_ID` — the advertising profile/marketplace account the
  ASIN belongs to.

Without Ads API credentials configured, that source is skipped gracefully and
the app still generates a file from autocomplete + comp-title + genre-metadata
+ buyer-intent keywords alone (at a discounted bid, since none of those
sources carry real bid data).

### Deploy

Push this repo to GitHub, then import it in Vercel and set the environment
variables above in the Vercel project settings. Every push to the connected
branch auto-deploys.

## Known open items

- **Bulksheet schema needs a final check against a live template.** The
  columns in `lib/bulksheet.ts` reflect Amazon's documented Sponsored Products
  bulk-operations schema, but Amazon revises it periodically. Before the first
  real upload, download a fresh template from Campaign Manager > Bulk
  Operations and diff its header row against `COLUMNS` in that file.
- **Auto-targeting clause and Product Targeting expression formats are
  unverified.** `AUTO_TARGETING_CLAUSES` in `lib/bulksheet.ts` writes the
  human-readable clause names (`close-match`, `loose-match`, `substitutes`,
  `complements`) rather than the API's internal codes (e.g.
  `queryHighRelMatches`), and product targets are written as `asin="B0..."`.
  Both are the same class of assumption already flagged for the Keyword rows
  above — confirm against a live downloaded template before uploading.
- **Bid economics formula deviates from the source doc's literal wording** —
  see the comment in `lib/bidding.ts`. The doc states
  `(Net revenue × ACOS) / conversion rate`; this implements
  `(Net revenue × ACOS) × conversion rate` instead, since dividing by a
  fraction inflates the max CPC above the max spend per sale. Worth a second
  look if the resulting bids look off in practice.
- **Harvest thresholds are untuned defaults** (`DEFAULT_HARVEST_THRESHOLDS` in
  `lib/harvest.ts`) — 300 impressions / 8 clicks / 1 order / 35% ACOS are
  reasonable starting points, not derived from this account's actual
  distribution. Adjust via the Harvest page's "advanced thresholds" once
  real harvest runs show how the promote/negate/monitor split lands.
- **Search Term report column matching is best-effort** (`HEADER_ALIAS_MAP` in
  `lib/harvest.ts`) — matches Amazon's current report headers
  (`Customer Search Term`, `Targeting`, `Impressions`, `Clicks`, `Spend`,
  `7 Day Total Orders (#)`, `7 Day Total Sales`) case/punctuation-insensitively.
  If Amazon renames a column, that field silently reads as 0 rather than
  erroring — spot-check the harvest summary counts after the first real run.
- **Ads API keyword-recommendations request/response shape** in
  `lib/amazonAds.ts` is written against the documented v3
  `sp/targets/keywords/recommendations` contract. Verify against the live
  OpenAPI spec once real credentials exist, before depending on it.
- **Ads API app registration status is unknown** — check the Amazon Ads
  developer console for an existing Client ID/Secret before the first
  non-mocked run.
- **Amazon and Google autocomplete scrapes are inherently fragile**
  (`lib/scrape.ts`) — both can change or block their unofficial endpoints
  without notice. Wired to fail soft (empty result), never to block the export.
- **Google Books "Common terms and phrases" scrape is unverified** — see the
  note above; check after deploy that it's actually finding terms, and adjust
  the DOM parsing in `scrapeGoogleBooksCommonTerms` if not.
- **Function duration** — `app/api/generate/route.ts` sets `maxDuration = 60`
  to give the autocomplete sweeps room to finish. If your Vercel plan caps
  function duration lower than that, reduce `AUTOCOMPLETE_CONCURRENCY` /
  `MAX_AUTOCOMPLETE_SEEDS` / `MAX_GOOGLE_SUGGEST_SEEDS` in `lib/scrape.ts`.
- **Brand Analytics / Search Query Performance** was skipped for v1 — it needs
  Brand Registry via Seller Central, unconfirmed for this account.
- **PA-API** was skipped for v1 — gated behind qualifying Amazon Associates
  sales, unconfirmed for this account.
- Default match-type mix for the cold-start generator is still user-chosen
  (broad/phrase/exact, any combination); the harvester always promotes to
  exact match only, matching the doc's harvesting guidance.

## Stack

- Next.js (App Router, TypeScript)
- `exceljs` for writing the Bulksheet `.xlsx` server-side
- `cheerio` for HTML scraping
- No database
