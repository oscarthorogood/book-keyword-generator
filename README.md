# Amazon Book Ads Builder

A two-phase Sponsored Products campaign builder for books: launch a cheap Auto
(SPA) campaign to let Amazon's own targeting discover what customers search
for, then harvest its Search Term report into a Manual (SPM) campaign of
exact-match keywords and product targets. A cold-start keyword generator is
still available for going straight to Manual, but the harvest loop is the
intended steady-state workflow. Built from two source docs: an analysis of a
live account (`AmazonAdsKeywordGeneratorCampaignBuilderLearnings`) and a
manual keyword-research process (`manual_amazon_book_ads_keyword_research_blueprint`)
— the latter's alphabet-soup search-bar harvest, best-seller "also bought"
deep dive, review/blurb language mining, and 3-way campaign structure are
all automated here to the extent a free scrape can approximate a human
research pass.

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
     bought" comp titles + their ASINs, category/best-seller placement,
     top-review excerpts, and the publisher's own description + bullets.
  2. Crawls a hop past the immediate comp titles — each comp's own "also
     bought" carousel — for more direct competitors' author, title, ASIN,
     *and* review text (bounded: up to 5 first-hop + 6 second-hop pages),
     approximating the research blueprint's best-seller deep dive.
  3. In parallel: calls the Amazon Ads API keyword-recommendations endpoint,
     sweeps Amazon's *and* Google's unofficial autocomplete endpoints across
     dozens of seed phrases (title, format/series-order/recency modifiers,
     title + a–z *and* a–z + title — see "Keyword generation" below), looks
     up the book in Google Books + Open Library for genre/subject data,
     scrapes Google Books' "About this book" page for its content-derived
     "Common terms and phrases" list, and looks up the book on Goodreads for
     community-tagged trope/genre shelves.
  4. All sources degrade gracefully — if one fails (no Ads API credentials, a
     blocked scrape, no ISBN match), the app carries on with whatever the
     other sources returned instead of failing the whole request.
  5. Templates genre/subject terms into buyer-intent phrases and Datamuse
     synonym expansions, mines recurring phrases out of review excerpts
     pooled across the seed book *and* every deep-crawled comp title, pulls
     explicit comp mentions ("perfect for fans of X") out of the book's own
     blurb, and generates format/series-order/recency modifiers seeded from
     real search term data.
  6. Merges everything, filters junk (generic terms, scraped-page boilerplate,
     garbled/bot queries), collapses near-duplicates, routes bare-ASIN
     "keywords"/ASIN-shaped candidates to product targeting instead of
     dropping them, scores each surviving keyword by source agreement,
     specificity (3-5 word phrases score highest), and phrase length.
  7. Splits the result into 3 Ad Groups — **Tropes & Themes**, **Comp Authors
     & Titles**, **Product Targeting** — each with its own bid tier, derived
     from RRP × net margin × target ACOS × conversion rate (or a manual
     override). Writes one Sponsored Products Bulksheet (Campaign / Ad Group /
     Product Ad / Keyword / Product Targeting rows per ad group), best-scoring
     keywords first in each.

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

## Campaign structure

The Manual (SPM) generator splits into 3 Ad Groups under one campaign,
matching the research blueprint's recommendation to track these separately
(section 5) — one campaign, not 3, so the naming convention below keeps its
fixed field count:

| Ad Group | Contents | Match Types | Bid tier |
| :--- | :--- | :--- | :--- |
| **Tropes & Themes** | Genre/subject terms, buyer-intent templates, autocomplete sweeps, review-mined phrases, category placement | User-selected (broad/phrase/exact) | 0.75× base (moderate — exploratory) |
| **Comp Authors & Titles** | Bare comparable author/title names, from the product page's own carousel and the deep 2-hop crawl | Exact only | 1.0× base (highest intent) |
| **Product Targeting** | Comp ASINs (own carousel + 2-hop crawl), plus any ASIN-shaped autocomplete/Ads-API "keywords" | n/a (ASIN targeting) | 0.9× base |

The Harvest flow uses a simpler 2-way split (**Harvested Keywords** +
**Product Targeting**) since it's promoting/negating already-tested terms
rather than doing fresh category research. Negative keywords from a harvest
are written as **Campaign Negative Keyword** rows (no Ad Group scoping) so
they suppress spend everywhere in the campaign, not just wherever the term
happened to first show up.

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

### ASIN or ISBN

Every ASIN/ISBN field (Generate, Harvest, Autofill) accepts an ISBN instead
of an ASIN — for print books, Amazon assigns the ISBN-10 directly as the
ASIN, so they're the same value. ISBN-13 (with or without hyphens) is
converted to its ISBN-10 equivalent and used as the ASIN
(`normalizeAsinOrIsbn` in `lib/isbn.ts`); 979-prefixed ISBN-13s have no
ISBN-10 equivalent and are rejected. All three routes normalize
server-side — the client never has to get this right on its own.

## Bid economics

Bids are derived from RRP rather than a flat default, matching the
downstream monitoring tracker's actual profitability math (net margin rate
0.4, i.e. `Net RRP = RRP × 0.4`):

```
maxCpc = (RRP × 0.4) × targetAcos × estConversionRate   (lib/bidding.ts)
```

That CPC ceiling is then tiered down for broader match types
(`MATCH_TYPE_BID_MULTIPLIER`), for Auto-targeting's more exploratory clauses
(substitutes/complements bid lower than close-match), and for the Manual
campaign's 3 ad groups (`AD_GROUP_BID_MULTIPLIER` — see "Campaign structure"
above). A manual Default Bid is still accepted as a fallback when RRP isn't
known.

### Keyword generation, in more detail

Everything here is free — no paid keyword APIs — so "effective" comes from
squeezing more signal out of the free sources rather than paying for a
better one:

- **Alphabet-soup autocomplete seeding, both directions** (`buildAutocompleteSeeds`
  in `lib/scrape.ts`) — Amazon's autocomplete returns different completions per
  next character, so sweeping `<title> a` through `<title> z` (suffix
  modifiers appearing after the phrase) *and* `a <title>` through `z <title>`
  (prefix modifiers appearing before it, e.g. "dark sci fi romance" — a query
  shape the suffix sweep alone can't reach) pulls far more real suggestions
  out of the same free endpoint than just querying the bare title. Plus
  format/series-order/recency-bestseller modifiers (`hardcover`, `books in
  order`, `best sellers`, etc.), patterns drawn from a real search term
  report and the manual research blueprint. Capped at 65 seeds, fetched with
  bounded concurrency so it doesn't hammer Amazon or blow a serverless
  function's time budget.
- **Deep 2-hop "also bought" crawl** (`scrapeRelatedCompetitors` in
  `lib/scrape.ts`) — goes past the target book's own comp-title carousel to
  each comp's *own* carousel, harvesting more directly comparable books'
  author, title, ASIN, and review text (bounded: 5 first-hop + 6 second-hop
  pages), an automated approximation of the research blueprint's best-seller
  deep dive. There's no way to automate the blueprint's "3-second rule" fit
  check (subgenre/tone/cover match) — this surfaces candidates for the
  scoring pipeline to rank, not a pre-vetted competitor list.
- **Review/blurb language mining, pooled across comps** (`mineReviewLanguage`
  in `lib/reviewMining.ts`) — frequency-counts recurring 2-4 word phrases
  (e.g. "slow burn", "locked room mystery") across review excerpts pooled
  from the seed book *and* every deep-crawled comp title, not just the seed
  book's own (often review-sparse) page — a phrase recurring across several
  bestselling comps' reviews is a stronger signal than one repeating within
  a single book's handful of reviews. Only the 5-star-adjacent "recurring
  buzzword" half of the blueprint's review-mining step is automated; the
  3-star "gap analysis" read ("I was hoping for more X") needs genuine
  reading comprehension, not phrase counting, and is left as a manual step.
- **Book description + bullet mining** (`buildDescriptionCandidates` in
  `lib/keywordMerge.ts`) — the publisher/author's own blurb and "About this
  item" bullets, never previously scraped. Explicit comp mentions ("perfect
  for fans of Richard Osman") become high-confidence comp-name candidates;
  short (2-8 word) bullets are taken as candidates directly rather than
  n-gram-mined for sub-phrases, since a single blurb doesn't repeat itself
  the way review text does — a frequency filter would zero everything out.
- **Datamuse synonym expansion** (`getSynonymExpansionCandidates` in
  `lib/datamuse.ts`) — a free, no-key, no-scraping-risk API
  ([api.datamuse.com](https://api.datamuse.com)) that expands the top
  genre/trope terms into related words ("detective" → "sleuth",
  "investigator", "gumshoe") the alphabet-soup sweep can't reach because
  they don't share a prefix with anything already seeded.
- **Goodreads trope/shelf tags** (`getGoodreadsTags` in `lib/goodreads.ts`)
  — looks the book up by ISBN (falling back to a title+author search) and
  scrapes its community-tagged genre/trope shelves ("enemies-to-lovers",
  "found-family", "cozy-mystery") — arguably the richest free source of
  exact fiction trope vocabulary, since it's crowd-tagged rather than
  inferred. Unverified against live Goodreads markup (same caveat as every
  other DOM-shape guess in this app) and routes through the same
  `SCRAPER_PROXY_API_KEY` as the Amazon scrapes if configured, since it's
  unconfirmed whether Goodreads (Amazon-owned, separate infra) blocks
  cloud IPs the same way.
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
- **Comp-name candidates** (`buildCompNameCandidates` in `lib/keywordMerge.ts`)
  — bare comparable author/title names, from the target book's own carousel
  and the deep 2-hop crawl, source-tagged `comp-name` so they land in the
  Comp Authors & Titles ad group (exact match only) rather than diluting the
  Tropes & Themes bucket.
- **Generic-term filtering** — standalone single words like "book", "novel",
  "kindle" are dropped; they're too broad to be worth a keyword slot alone
  even though they're kept as part of a longer phrase.
- **Phrase-length scoring** (`phraseLengthScore` in `lib/keywordMerge.ts`) —
  the manual research blueprint's filter for the alphabet-soup harvest
  ("only add phrases 3 to 5 words long... ignore generic single or two-word
  terms") is applied as a scoring bonus rather than a hard cutoff, so a
  strong 2-word comp-author name still competes.
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
- **Per-ad-group caps** — Tropes & Themes follows Amazon's own
  keyword-targeting guidance of 25-50 keywords per ad group
  (`RECOMMENDED_MIN_KEYWORDS` / `RECOMMENDED_MAX_KEYWORDS`); the UI flags it
  if free sources come up short of 25 rather than padding with filler. Comp
  Authors & Titles caps at 40 (`COMP_NAME_MAX_KEYWORDS`, matching the
  blueprint's 20-40 direct-competitor target) and Product Targeting at 30
  (`PRODUCT_TARGET_MAX` in `lib/productTargets.ts`) — both independent of the
  Tropes cap since they're now separate ad groups, not one shared budget.

## Autofill from ASIN

Both forms have an **Autofill** button next to the ASIN field
(`/api/lookup`) that scrapes just the target book's own product page —
title, author, series, and a best-effort list price — and fills in Book
Title / Author Name / Series Name / RRP. It's a lighter-weight version of
the full product-page scrape in the generate pipeline (no comp crawl, no
keyword research), so it responds quickly enough to run before the user
fills in the rest of the form. Series and price extraction are best-effort
(`extractSeriesName` / `extractPrice` in `lib/scrape.ts`) — Amazon shows
several prices per page (Kindle/paperback/hardcover) and this just takes the
first one found, so treat the prefilled RRP as a starting point to verify,
not a guaranteed print list price.

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

Optional:

- `SCRAPER_PROXY_API_KEY` — see "Scraping from a cloud deployment" below.
  Needed on Vercel/most cloud hosts; not needed for local dev.

### Deploy

Push this repo to GitHub, then import it in Vercel and set the environment
variables above in the Vercel project settings. Every push to the connected
branch auto-deploys.

### Scraping from a cloud deployment (Vercel, etc.)

Amazon blocks/CAPTCHAs product-page requests from datacenter IP ranges at the
network level — this is routine for Vercel, AWS, and similar cloud hosts, and
much rarer from a home IP. When it happens, Autofill and the Manual (SPM)
generator's comp-title/comp-name crawl, product targeting, and
review-language mining all degrade to "no results" (never a hard failure —
see `scrapeProductPage` in `lib/scrape.ts`), and `/api/lookup` returns a
"blocked" error you can see in the UI.

The fix: set `SCRAPER_PROXY_API_KEY` to a [ScraperAPI](https://www.scraperapi.com)
key (free tier is ~1,000 requests/month, plenty for single-user use). When
set, `scrapeProductPage`'s fetch — and the Goodreads lookup in
`lib/goodreads.ts` — route through ScraperAPI's residential/rotating-IP proxy
(`resolveScraperProxyUrl` in `lib/scrape.ts`) instead of hitting the target
directly; unset, both fall back to a direct fetch (fine for local dev). This
is scoped to full-page HTML fetches only — **not** the autocomplete JSON
endpoints (`getAutocompleteSuggestions`) or the Datamuse API, which run
dozens of times per generate call and would burn through a proxy's free tier
fast, and it's unconfirmed whether Amazon blocks the autocomplete endpoint
the same way it blocks the product page. If you find autocomplete is *also*
blocked on your deployment, the same `resolveScraperProxyUrl` pattern can be
applied there — check server logs first (`[scrapeProductPage] ... -> HTTP
...` / `... bot/CAPTCHA check`) to confirm before spending proxy credits on it.

To swap in a different proxy provider (ScrapingBee, ZenRows, Bright Data,
etc.), edit `resolveScraperProxyUrl` in `lib/scrape.ts` — most use a similar
`?api_key=...&url=...` query-param shape.

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
- **Review snippet selectors are unverified against a live page** — same
  caveat as the Google Books scrape below. `extractReviewSnippets` in
  `lib/scrape.ts` targets Amazon's current `data-hook="review-body"` /
  `review-collapsed` markup; if Amazon restructures the reviews section, this
  degrades to "no review-language candidates," not an error. Spot-check the
  `review-language` source count after deploy.
- **Description/bullet selectors are unverified too** — `extractDescription`
  / `extractBulletPoints` in `lib/scrape.ts` target
  `#bookDescription_feature_div` / `#feature-bullets`, current as of writing
  but not confirmed against a live page. Same fail-soft behavior as
  everything else here.
- **Goodreads markup is unverified and its blocking behavior unknown** —
  `extractShelfTags` in `lib/goodreads.ts` guesses at current Goodreads
  genre-tag selectors, and whether Goodreads applies the same datacenter-IP
  blocking Amazon does (it's Amazon-owned but separate infra) is untested.
  Spot-check the `goodreads-tags` source count after deploy; if it's
  consistently empty even with `SCRAPER_PROXY_API_KEY` set, the selectors
  are the more likely culprit than blocking.
- **Deep-crawl request budget is a judgment call, not a measured one** —
  5 first-hop + 6 second-hop page scrapes (`FIRST_HOP_ASIN_LIMIT` /
  `SECOND_HOP_ASIN_LIMIT` in `lib/scrape.ts`) run concurrently within the
  same `maxDuration = 60` window as everything else. Fine in testing; worth
  watching for timeouts on a slower host or a book with an unusually large
  "also bought" graph.
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
