# Amazon Book Ads Builder

A Manual Sponsored Products campaign builder for books. The flow is
deliberately simple: enter an ASIN or ISBN, the app gathers as much book
metadata as it can find for free, scrapes keyword candidates from every
source it knows how to query, runs an AI pass to judge which ones are
actually worth testing, and hands back a ready-to-upload Bulksheet. Built
from two source docs: an analysis of a live account
(`AmazonAdsKeywordGeneratorCampaignBuilderLearnings`) and a manual
keyword-research process (`manual_amazon_book_ads_keyword_research_blueprint`)
— the latter's alphabet-soup search-bar harvest, best-seller "also bought"
deep dive, review/blurb language mining, and 3-way campaign structure are
all automated here to the extent a free scrape can approximate a human
research pass.

This app only ever builds **Manual** campaigns — Amazon's engine-driven Auto
campaigns and the promote/negate-from-a-report workflow aren't part of it by
design; the whole point is a self-contained "ASIN in, best-effort keyword
list out" tool. More functionality (including possibly that workflow) may
get layered on later, but the core loop below is meant to stay simple.

One page, two API routes, no database — stateless: one request in, one file
out. Gated behind magic-link sign-in with an admin-approved allowlist.

## How it works

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
7. An optional AI pass (Google Gemini) reviews the heuristically-shortlisted
   candidates against the book's actual context and decides which are worth
   testing — see "AI-assisted ranking" below.
8. Splits the result into 3 Ad Groups — **Tropes & Themes**, **Comp Authors
   & Titles**, **Product Targeting** — each with its own bid tier, derived
   from RRP × net margin × target ACOS × conversion rate (or a manual
   override). Writes one Sponsored Products Bulksheet (Campaign / Ad Group /
   Product Ad / Keyword / Product Targeting rows per ad group), best-scoring
   keywords first in each.

## Campaign structure

The generator splits into 3 Ad Groups under one campaign, matching the
research blueprint's recommendation to track these separately (section 5):

| Ad Group | Contents | Match Types | Bid tier |
| :--- | :--- | :--- | :--- |
| **Tropes & Themes** | Genre/subject terms, buyer-intent templates, autocomplete sweeps, review-mined phrases, category placement | User-selected (broad/phrase/exact) | 0.75× base (moderate — exploratory) |
| **Comp Authors & Titles** | Bare comparable author/title names, from the product page's own carousel and the deep 2-hop crawl | Exact only | 1.0× base (highest intent) |
| **Product Targeting** | Comp ASINs (own carousel + 2-hop crawl), plus any ASIN-shaped autocomplete/Ads-API "keywords" | n/a (ASIN targeting) | 0.9× base |

## Campaign naming convention

Every campaign this app creates follows:

```
PB_{creator initials}_{ASIN}_{Author}_{Series Name}_{Title}_{Country}_SPM_{variant}
```

e.g. `PB_MO_103671165X_Andrew Raymond_A DC Mairead Maclean Mystery_The Long Isle_UK_SPM_1`

This isn't optional or free-text — it's what lets the downstream monitoring
system parse ASIN and Author back out of the campaign name with a plain
string split, no lookup table needed (`lib/naming.ts`). The generator
computes it server-side from structured fields rather than accepting a
free-text campaign name. The `SPM` token is fixed (this app only builds
Manual campaigns) but kept in the name so the field count/position matches
what downstream tooling already expects.

### ASIN or ISBN

The ASIN/ISBN field (Generate, Autofill) accepts an ISBN instead of an ASIN
— for print books, Amazon assigns the ISBN-10 directly as the ASIN, so
they're the same value. ISBN-13 (with or without hyphens) is converted to
its ISBN-10 equivalent and used as the ASIN (`normalizeAsinOrIsbn` in
`lib/isbn.ts`); 979-prefixed ISBN-13s have no ISBN-10 equivalent and are
rejected. Both routes normalize server-side — the client never has to get
this right on its own.

## Bid economics

Bids are derived from RRP rather than a flat default, matching the
downstream monitoring tracker's actual profitability math (net margin rate
0.4, i.e. `Net RRP = RRP × 0.4`):

```
maxCpc = (RRP × 0.4) × targetAcos × estConversionRate   (lib/bidding.ts)
```

That CPC ceiling is then tiered down for broader match types
(`MATCH_TYPE_BID_MULTIPLIER`) and for the campaign's 3 ad groups
(`AD_GROUP_BID_MULTIPLIER` — see "Campaign structure" above). A manual
Default Bid is still accepted as a fallback when RRP isn't known.

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

## AI-assisted ranking

With ~10 different free sources feeding the candidate pool (Ads API, Amazon
+ Google autocomplete, Google Books API + web scrape, Open Library, Amazon
comp-title/comp-name crawling, review-language mining, book description
mining, Datamuse synonym expansion, Goodreads tags), the harder problem
shifts from "find enough keywords" to "which of these hundreds of candidates
are actually worth testing, and in which ad group." Two ranking stages
handle that, in order:

1. **Heuristic pre-filter** (`scoreAndTierBids` in `lib/keywordMerge.ts`,
   unchanged) — scores every raw candidate by source agreement, phrase
   length, and Ads-API presence. This runs first regardless of AI
   configuration, and narrows the raw pool down to a shortlist 1.6× the
   final per-ad-group cap (`AI_SHORTLIST_MULTIPLIER` in the generate route).
   **This is also the sole ranking when AI isn't configured** — it's a
   complete, good-enough ranking on its own, not just scaffolding for the AI
   step.
2. **AI final pass** (`rankKeywordsWithAi` in `lib/aiRanker.ts`, optional) —
   sends that shortlist, plus book context (title/author/series/genre terms/
   description, and optionally a Firecrawl markdown scrape of the product
   page for richer natural-language context — `lib/firecrawl.ts`), to Google
   Gemini's free tier. Gemini judges each candidate's real-world relevance to
   *this specific book* — something no heuristic can do — can reclassify a
   candidate between Tropes/Comp-Names, can drop candidates the heuristic
   would've kept, and returns a 0-100 relevance score used for final sort
   order and the per-ad-group cap.

Uses Gemini rather than a paid API specifically to keep this optional step
free — no credit card required for Google AI Studio's free tier. If
`GEMINI_API_KEY` is unset, or the API call fails or times out for any
reason, the app **silently falls back to the heuristic shortlist** — the AI
pass never blocks the export, matching the fail-soft pattern every other
optional source in this app follows. Whether it actually ran is reported via
the `X-Ai-Ranking-Used` response header and shown in the success banner.

`FIRECRAWL_API_KEY` only has an effect when `GEMINI_API_KEY` is also set —
it purely enriches the context Gemini sees, it isn't an independent feature.
Firecrawl is not used as a fetch mechanism for the structured scrapes
elsewhere in this app (its markdown output would break the cheerio
selector-based extraction those rely on) — it's scoped to this one purpose.

## Autofill from ASIN — the Book Profile

The form has an **Autofill** button next to the ASIN field (`/api/lookup`)
that builds a full book profile from the ASIN/ISBN alone, before the user
fills in anything else:

- Title, author, series, and a best-effort list price — fills Book Title /
  Author Name / Series Name / RRP directly.
- **Category path** — Amazon's own breadcrumb hierarchy in order (e.g.
  `Books › Mystery, Thriller & Suspense › Cozy › Culinary`), so genre and
  subgenre are read off Amazon's own taxonomy rather than guessed at.
- **Best Sellers Rank** — the actual rank numbers (`#12 in Cozy Mystery`),
  not just the category names the rest of the pipeline uses.
- **Description + bullets** — the publisher's own blurb, same extraction the
  generate pipeline uses for comp-mention mining (`buildDescriptionCandidates`).
- **A combined, deduped tag list** — every free source this app already
  queries, pulled into one list on this first call: the category path,
  Google Books categories, Open Library subjects, and Goodreads shelf tags.
  Shown as removable chips on the Generate form (`app/page.tsx`) — prune
  anything irrelevant, or add your own — and whatever's left when you hit
  Generate is sent as `knownTags` on the request.

`knownTags` isn't just informational — it's folded directly into keyword
generation as a new high-trust `user-tag` source
(`buildKnownTagCandidates` in `lib/keywordMerge.ts`, scored above an
algorithmically-agreed-upon term since a human reviewed it) and used to seed
buyer-intent templating, Datamuse synonym expansion, and the AI ranking
step's book context. A human-curated genre list at the top of the funnel is
meant to raise the floor on everything downstream, not just add one more
source alongside the rest.

This is a heavier call than the old title/author-only Autofill — it now
also calls Google Books, Open Library, and Goodreads in parallel after the
Amazon scrape, so `/api/lookup`'s `maxDuration` is 45s (vs 20s before) to
give Goodreads' occasional two-hop lookup (search + book page) room. Series
and price extraction remain best-effort (`extractSeriesName` /
`extractPrice` in `lib/scrape.ts`) — Amazon shows several prices per page
(Kindle/paperback/hardcover) and this just takes the first one found, so
treat the prefilled RRP as a starting point to verify, not a guaranteed
print list price.

"Region" isn't part of this yet — the whole profile is scraped from
whichever single marketplace is selected in the form. Cross-marketplace
comparison (does this book rank differently on .com vs .co.uk?) would mean
scraping the same ASIN across multiple domains, which isn't built — flag if
that's worth adding.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run dev
```

### Environment variables

See `.env.example`. Required:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` — back both authentication and bulksheet
  archiving. See "Authentication" below.
- `AUTH_SECRET` — signs the approve/deny links. Must be a long random value in
  production.
- `RESEND_API_KEY` / `EMAIL_FROM` / `ADMIN_EMAIL` — send the sign-in and
  approval emails.
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
- `GEMINI_API_KEY` / `FIRECRAWL_API_KEY` — see "AI-assisted ranking" above.
  Neither is required; the app ranks keywords with the heuristic scorer
  alone when they're unset.
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` — see "Bulksheet
  archiving" below. Both are needed together; unset means downloads only.

### Authentication

Sign-in is a **magic link gated by an allowlist**. There is no password.

1. Someone enters their email on `/login`.
2. If the address is **approved**, they're emailed a one-time sign-in link.
3. If it's **new**, it's recorded as `pending` and `ADMIN_EMAIL` receives an
   email with **Approve** and **Deny** buttons.
4. Approving emails them a working sign-in link immediately. Denying is silent
   — they're never told.

The allowlist lives in `public.access_requests`, with RLS on and zero policies,
so only the service role can read it. To pre-approve someone without waiting
for them to ask:

```sql
insert into public.access_requests (email, status, decided_at)
values ('them@example.com', 'approved', now())
on conflict (email) do update set status = 'approved', decided_at = now();
```

To revoke, set `status` to `'denied'` — they lose the ability to request new
links, though an already-issued session survives until it expires.

**Approve/deny links carry no session** — they're clicked straight from a phone
mail app. What makes that safe: each link is HMAC-signed with `AUTH_SECRET`, is
bound to a nonce that's cleared on first use (so it works exactly once), and
expires after 14 days. This is why `AUTH_SECRET` must be a real random value in
production; the code falls back to a hardcoded development default, and with
that in place anyone could forge an approval for their own address.

Magic links are minted server-side (`lib/magicLink.ts`) and delivered through
Resend rather than Supabase's built-in mailer, which is rate-limited to a few
messages an hour and not intended for production. Nothing extra needs
configuring in the Supabase dashboard.

Route protection is in `proxy.ts` (Next 16's rename of `middleware.ts`).
Because a matcher change can silently drop coverage, `/api/generate` and
`/api/lookup` re-check the session themselves.

### Bulksheet archiving (Supabase Storage)

When both Supabase variables are set, `/api/generate` uploads a copy of each
generated `.xlsx` to a **private** Storage bucket named `bulksheets` and
returns a 1-hour signed link in the `X-Archive-Url` response header, which the
UI renders under the success banner. Objects are keyed
`YYYY/MM/DD/<uuid>-<campaign>.xlsx`, so re-runs never overwrite each other and
date-based cleanup is easy.

Create the bucket once (Storage > New bucket, private, MIME type
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).

Two things to keep straight:

- The service-role key bypasses row-level security. It is read only in
  `lib/supabaseStorage.ts`, which is server-only — never import that module
  from a Client Component, and never rename the var to `NEXT_PUBLIC_*`.
- No Storage RLS policies are required, because only the service role touches
  the bucket. If you later let the browser read or write it directly, you must
  add policies on `storage.objects` first.

Archiving is best-effort: a missing bucket, expired key, or Storage outage is
logged server-side and the bulksheet still downloads normally.

### Deploy

Push this repo to GitHub, then import it in Vercel and set the environment
variables above in the Vercel project settings. Every push to the connected
branch auto-deploys.

### Scraping from a cloud deployment (Vercel, etc.)

Amazon blocks/CAPTCHAs product-page requests from datacenter IP ranges at the
network level — this is routine for Vercel, AWS, and similar cloud hosts, and
much rarer from a home IP. When it happens, Autofill and the generator's
comp-title/comp-name crawl, product targeting, and review-language mining
all degrade to "no results" (never a hard failure — see `scrapeProductPage`
in `lib/scrape.ts`), and `/api/lookup` returns a "blocked" error you can see
in the UI.

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
- **Product Targeting expression format is unverified.** Product targets are
  written as `asin="B0..."` — the same class of assumption already flagged
  for the Keyword rows above — confirm against a live downloaded template
  before uploading.
- **Bid economics formula deviates from the source doc's literal wording** —
  see the comment in `lib/bidding.ts`. The doc states
  `(Net revenue × ACOS) / conversion rate`; this implements
  `(Net revenue × ACOS) × conversion rate` instead, since dividing by a
  fraction inflates the max CPC above the max spend per sale. Worth a second
  look if the resulting bids look off in practice.
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
- **Gemini and Firecrawl request/response shapes are unverified against a
  live call** — both were written against their documented API contracts
  (Gemini's `generateContent` + `responseSchema`, Firecrawl's `/v1/scrape`)
  from a network-restricted environment that couldn't reach either service
  to confirm. Both fail soft (silent fallback to heuristic-only ranking /
  no extra context) rather than erroring, so a contract mismatch degrades
  quietly — check `X-Ai-Ranking-Used` and the server logs
  (`[rankKeywordsWithAi] ...` / `[scrapeMarkdown] ...`) after the first real
  run to confirm they're actually working, not just failing silently.
- **Gemini model name will need updating eventually** — `GEMINI_MODEL` in
  `lib/aiRanker.ts` is hardcoded to a specific Flash model. Google's model
  lineup moves fast; if AI ranking starts silently falling back (a 404 in
  the logs), check aistudio.google.com for the current free-tier model name.
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
- Default match-type mix for the Tropes & Themes ad group is still
  user-chosen (broad/phrase/exact, any combination) — no auto-tuning based
  on real performance data yet, since that would mean ingesting a Search
  Term report, which isn't part of this tool's scope right now.

## Stack

- Next.js (App Router, TypeScript)
- `exceljs` for writing the Bulksheet `.xlsx` server-side
- `cheerio` for HTML scraping
- No database
