# Amazon Book Keyword Tool

Enter a book ASIN and a few campaign settings, get back a Bulksheet-ready `.xlsx`
file to upload directly into Amazon Ads' bulk operations tool to create a manual
Sponsored Products campaign.

Single page, single API route, no database — stateless: one request in, one
file out. Gated behind HTTP Basic Auth for private/single-user use.

## How it works

1. Scrapes the book's own Amazon product page for title/author/ISBN, "customers
   also bought" comp titles + their ASINs, and category/best-seller placement.
2. In parallel: calls the Amazon Ads API keyword-recommendations endpoint,
   sweeps Amazon's *and* Google's unofficial autocomplete endpoints across
   dozens of seed phrases (title, title + book/series/audiobook/kindle, title
   + a–z — see "Keyword generation" below), scrapes categories from a few of
   the comp titles' own product pages, looks up the book in Google Books +
   Open Library for genre/subject data, and scrapes Google Books' own "About
   this book" page for its content-derived "Common terms and phrases" list.
3. All sources degrade gracefully — if one fails (no Ads API credentials, a
   blocked scrape, no ISBN match), the app carries on with whatever the other
   sources returned instead of failing the whole request.
4. Templates the genre/subject terms into buyer-intent phrases ("best fantasy
   books", "books like `<title>`") — free long-tail candidates generated from
   data already fetched, no extra calls.
5. Merges everything, drops overly-generic standalone terms ("book", "novel"),
   collapses near-duplicates (plurals, word order), scores each surviving
   keyword by source agreement and specificity, and tiers its bid down if only
   one source backs it.
6. Writes a Sponsored Products Bulksheet (Campaign / Ad Group / Product Ad /
   Keyword rows), best-scoring keywords first, and streams it back as a
   download.

### Keyword generation, in more detail

Everything here is free — no paid keyword APIs — so "effective" comes from
squeezing more signal out of the free sources rather than paying for a
better one:

- **Alphabet-soup autocomplete seeding** (`buildAutocompleteSeeds` in
  `lib/scrape.ts`) — Amazon's autocomplete returns different completions per
  next character, so sweeping `<title> a` through `<title> z` (plus a few
  buyer-language modifiers) pulls far more real suggestions out of the same
  free endpoint than just querying the bare title. Capped at 40 seeds,
  fetched with bounded concurrency so it doesn't hammer Amazon or blow a
  serverless function's time budget.
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
  with generic intent phrasing to generate long-tail candidates for free.
- **Generic-term filtering** — standalone single words like "book", "novel",
  "kindle" are dropped; they're too broad to be worth a keyword slot alone
  even though they're kept as part of a longer phrase.
- **Near-duplicate collapsing** — a plural/word-order-insensitive signature
  merges near-identical candidates ("wizard school books" / "wizard schools
  book") so budget isn't split across the same idea twice.
- **Confidence scoring + bid tiering** — keywords multiple independent
  sources agree on (and Ads-API-sourced ones, which carry real bid data)
  score highest and keep their bid; single-source speculative terms get a
  discounted bid so testing them risks less spend. The Bulksheet output is
  sorted best-first.

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
- Default match-type mix and negative keywords for v1 are not yet decided;
  the form currently lets you pick any combination of broad/phrase/exact and
  ships no negative keywords.

## Stack

- Next.js (App Router, TypeScript)
- `exceljs` for writing the Bulksheet `.xlsx` server-side
- `cheerio` for HTML scraping
- No database
