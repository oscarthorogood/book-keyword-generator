# Amazon Book Keyword Tool

Enter a book ASIN and a few campaign settings, get back a Bulksheet-ready `.xlsx`
file to upload directly into Amazon Ads' bulk operations tool to create a manual
Sponsored Products campaign.

Single page, single API route, no database — stateless: one request in, one
file out. Gated behind HTTP Basic Auth for private/single-user use.

## How it works

1. Scrapes the book's own Amazon product page for title/author/ISBN, "customers
   also bought" comp titles, and category/best-seller placement.
2. In parallel: calls the Amazon Ads API keyword-recommendations endpoint,
   scrapes Amazon's unofficial autocomplete endpoint, and looks up the book in
   Google Books + Open Library for genre/subject data.
3. All sources degrade gracefully — if one fails (no Ads API credentials, a
   blocked scrape, no ISBN match), the app carries on with whatever the other
   sources returned instead of failing the whole request.
4. Merges everything into one deduped, source-tagged keyword list.
5. Writes a Sponsored Products Bulksheet (Campaign / Ad Group / Product Ad /
   Keyword rows) and streams it back as a download.

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
keywords alone.

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
- **Amazon autocomplete scrape is inherently fragile** (`lib/scrape.ts`) —
  Amazon can change or block the unofficial endpoint without notice. It's
  wired to fail soft (empty result), never to block the export.
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
