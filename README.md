# Amazon Book Ads Builder

A keyword research tool for book ads. The flow is deliberately simple:

1. **Add a book** — paste its Amazon link (or an ASIN/ISBN). That is the
   whole form.
2. **Generate keywords** — from the book page, the app builds a long,
   reviewable keyword list out of 20-plus free sources.

Built from two source docs: an analysis of a live account
(`AmazonAdsKeywordGeneratorCampaignBuilderLearnings`) and a manual
keyword-research process (`manual_amazon_book_ads_keyword_research_blueprint`)
— the latter's alphabet-soup search-bar harvest, best-seller "also bought"
deep dive and review/blurb language mining are all automated here to the
extent a free scrape can approximate a human research pass.

Gated behind magic-link sign-in with an admin-approved allowlist.

## How it works

### One capture per book, at creation time

Adding a book reads its Amazon page **once** and stores everything it found
on the book row as a snapshot (`lib/bookSnapshot.ts`, persisted to
`books.metadata_json`). The page is read two ways in parallel, because
Amazon CAPTCHAs product-page requests from datacenter IPs:

- **Firecrawl** (`FIRECRAWL_API_KEY`) renders and extracts the page from its
  own infrastructure — the reliable path from a cloud deployment. It returns
  title, author, series, categories, best-seller ranks, comparable titles and
  authors, review snippets and Q&A.
- **The direct scrape** (optionally via ScraperAPI / SerpApi) gets the
  structured bits Firecrawl can't: comp ASINs, the author's catalogue link.

Whichever succeeds fills the snapshot; when both do, the direct scrape's
precise fields win and Firecrawl fills the gaps. The same call also crawls a
hop past the immediate comp titles for more competitors and their review
text, pulls customer Q&A and reviews, and looks the book up in Google Books,
Open Library, Goodreads, Wikipedia, Wikidata and the Library of Congress.

Every source is best-effort and time-budgeted: one slow or blocked source
never sinks the capture. If the page couldn't be read at all the book is
still created, but it's labelled honestly and the book page offers a
**Re-fetch metadata** button rather than silently showing "Unknown Title".

### Genre resolution

What kind of book this is gets decided once, from the book's own taxonomy —
Amazon's breadcrumb and best-seller categories, Google Books categories, Open
Library subjects, Goodreads shelves, Wikidata genres (`lib/genre.ts`) — and
everything downstream is seeded from it.

Two things this fixes, both of which used to poison whole keyword lists:

- Genre is no longer assumed. The autocomplete sweep and the theme/synonym
  lexicons used to be hardcoded to thriller/mystery/crime, so a romance or a
  cookbook got seeded with `<title> thriller` and generated crime keywords
  off the back of it.
- Amazon's breadcrumb is a *store* path, not a list of search phrases.
  `Kindle Store › Kindle eBooks › Mystery, Thriller & Suspense` is now
  stripped of store scaffolding and split into the phrases readers actually
  type, instead of templating into keywords like "best kindle store books".

### Keyword generation

Generating keywords reads the stored snapshot instead of re-scraping Amazon,
so it's fast, repeatable, and works from exactly the metadata the book page
shows you. Only the cheap, unblocked endpoints run live per generate: the
four autocomplete engines (Amazon, Google, YouTube, DuckDuckGo), SerpApi's
Amazon Search/Autocomplete APIs, and the Amazon Ads API when configured.

From there it merges every source, filters junk (generic terms, store
scaffolding, scraped-page boilerplate, garbled queries), collapses
near-duplicates, scores each survivor by source agreement, specificity and
category relevance, and assigns a match type per keyword: comparable
author/title names run **exact**, specific 3+ word phrases run **phrase**,
short generic terms run **broad**. An optional AI pass (Google Gemini)
re-orders the list and drops off-topic candidates — it never truncates it.

Everything then goes through the **relevance filter pipeline** (below),
which decides what is actually worth bidding on for this book before
anything is activated.

The result lands in the book's keyword manager as a long list (up to 300
thematic keywords plus 120 comparable names) to review, filter, re-tier and
prune — with the rejected candidates kept alongside it, each labelled with
the filter that stopped it and why.

Every keyword also gets a **Broad → Specific** rating (1–5, `lib/
keywordSpecificity.ts`) shown as a sortable/filterable column: word count,
anchor hits (title/author/series/character names), semantic category, and
generic book-intent tokens ("books", "kindle", "read") all feed it, kept
consistent with match-type assignment so a comparable-title keyword rarely
reads as "Broad". Requires `sql/09-keyword-specificity.sql`; keywords
generated before that migration show no rating.

### Relevance filtering

Generation is source-led: every source contributes what it found. Nothing
used to check that any of it was about *this* book, which is how a Scottish
crime thriller ended up bidding on `scottish fold cat` (autocomplete drift),
`felon books` (thesaurus expansion), `his team was put` (a raw review
n-gram) and `264 pages` (page chrome).

`lib/keywordFilters.ts` is the shared validation layer that was missing. It
runs after generation and before anything is written as active, as an
ordered pipeline where each filter returns **reject** (never bid), **pause**
(keep, don't activate) or **pass** (continue):

| # | Filter | What it stops |
|---|---|---|
| 1 | `uiPollution` | Page chrome and detail-table labels — `264 pages`, `learn more`, `language: english` |
| 2 | `languageMarket` | Languages the listing isn't in — `crime thriller books malayalam` |
| 3 | `offTopicEntity` | Autocomplete drift — `scottish premier league fixtures`, `scars of the past turtle wow` |
| 4 | `reviewFragment` | Raw review prose — `credit to a superb`, `written by ian rankin` |
| 5 | `synonymQuality` | Thesaurus artifacts — `felon books`, `erse books` |
| 6 | `descriptionShape` | Blurb verb fragments — `killer leaves`, `case spirals` |
| 7 | `formatAvailability` | Formats the ASIN doesn't have — `jacqueline new hardcover` on a Kindle-only book |
| 8 | `seasonalGift` | Seasonal terms with no book intent, and out-of-season activation |
| 9 | `singleWord` | One-word keywords too broad to bid on — `scottish`, `detective` |
| 10 | `phraseShape` | Dangling modifiers — `fast paced scottish` (rewritten to `fast paced scottish crime thriller`) |
| 11 | `anchorRelevance` | The final gate: anything that names nothing specific to this book |

The gate at the end is the important one. Each book gets **anchors** derived
from its own scrape (`lib/keywordAnchors.ts`) — its title/author/series and
character names, its genre vocabulary, its setting, and its comparable
authors. A keyword passes only if it contains at least one of those.
Generic book-intent words (`books`, `kindle`, `read`) never qualify a
keyword on their own, which is the whole difference between `english books`
(dropped) and `scottish crime books` (kept).

Rejections are kept, not discarded: they're stored with `status: rejected`,
the deciding filter and its reason, so the keyword manager can show why —
and a false positive can be reviewed and put back. The rejections that
describe a real (unwanted) *search intent* — off-topic entities, wrong
languages, missing formats — are also turned into **negative keywords**, so
Amazon can't serve on them through a broader match. Any rejected keyword can
also be **promoted to the negative-keyword library** (below) with one click,
so the same off-topic term doesn't have to be rediscovered on every other
book.

Blocklists live in `lib/keywordFilterConfig.ts` so they can be tuned per
marketplace or genre; per-filter rejection counts come back with every
generate run. "Re-run filters" in the keyword manager applies the pipeline
to a book's existing keywords (`POST /api/books/[id]/keywords/filter`) —
the migration path for lists generated before it existed.

### Shared negative-keyword library

Negatives can live above the per-book level: **global** (applies to every
export), **genre**-scoped (applies when a book's resolved genre matches a
preset genre), or **book**-scoped. `POST /api/negative-keywords` adds one —
the keyword manager's "promote to negative library" button on any rejected
keyword does this for you, global-scoped by default, and warns (without
blocking) if the term collides with an active keyword on any of your books.
Requires `sql/12-negative-keyword-library.sql`.

### Cross-book cannibalization

The same keyword active on two of your books competes against itself in
Amazon's auction. `/keywords` flags every such keyword with a **Shared**
badge (and a toggle to filter down to just those), and each affected book's
own keyword manager shows a callout with a one-click **keep here, pause
elsewhere** action, defaulting to whichever book's copy is more specific
(tie-broken by bid — there's no performance data yet to rank by, see the
`GET /api/books/[id]/keywords/cannibalization` reference). Same-author
books sharing an author-name keyword are exempted — that's brand defense,
not cannibalization.

### Exporting to Amazon Ads

"Export bulksheet" (`GET /api/books/[id]/keywords/export`) writes a
bulk-upload CSV: a descriptive Broad/Phrase campaign, a comparable
titles/authors Exact campaign, an **Auto Discovery** campaign (a small slice
of the daily budget, split into Amazon's four auto-targeting groups — close
match, substitutes, loose match, complements — so search-term harvesting has
something to feed on), and an ASIN/brand product-targeting campaign built
from the competitor crawl (`lib/productTargets.ts`, ranked by best-seller
rank and review count). Negatives (per-book plus whatever applies from the
shared library above) ship in every campaign the export creates, not just
the descriptive one. Rejected keywords are never exported.

## Identifiers

### ASIN or ISBN

The add-book field accepts an Amazon product link, an ASIN, or an ISBN —
for print books, Amazon assigns the ISBN-10 directly as the ASIN, so an ISBN
and an ASIN are the same value. ISBN-13 (with or without hyphens) is converted to
its ISBN-10 equivalent and used as the ASIN (`normalizeAsinOrIsbn` in
`lib/isbn.ts`); 979-prefixed ISBN-13s have no ISBN-10 equivalent and are
rejected. A pasted link also carries its own marketplace (amazon.co.uk vs
amazon.com), which wins over the marketplace dropdown — scraping a .co.uk
listing against amazon.com returns a different book, or nothing at all
(`parseAmazonInput` in `lib/amazonUrl.ts`). Parsing happens server-side too,
so the client never has to get this right on its own.

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
- **Controlled genre-synonym expansion** (`expandSynonyms` in
  `lib/synonyms.ts`) — an allowlist map from genre phrase to genre phrase
  ("crime fiction" → "detective fiction", "murder mystery", "police
  procedural", "noir"). This replaced an open-ended thesaurus lookup
  (Datamuse's "means like") that expanded individual tokens: asked about
  "crime" it answered "law-breaking", "perpetrator", "felon"; asked about
  "scottish" it answered "erse", "scotch", "scotia" — none of which anyone
  types when buying a book. Nationality/setting words and bare emotional
  tokens are never expanded at all.
- **Listing HTML metadata** (`buildListingMetadataCandidates` in
  `lib/listingKeywords.ts`) — Amazon's own `<meta name="keywords">` terms,
  the `<title>` tag, the canonical URL slug and the variation swatches, plus
  field-weighted n-grams across all of it (title 3.0, meta keywords 2.5,
  bullets 2.0, slug 2.0, reviews 1.5, description 1.0) so a phrase in the
  product title outranks the same phrase buried in the blurb.
- **SerpApi Amazon Search + Autocomplete** (`lib/serpApiKeywords.ts`) —
  Amazon's own *related searches* for a seed term (keyword expansions Amazon
  publishes from real shopper behaviour), the titles/authors ranking for it,
  and the search-bar suggestions readers see while typing. Licensed access
  rather than scraping, credit-metered per run, and skipped entirely without
  a key.
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
  page scraping. Both were confirmed present in real production keyword output.
- **Bare-ASIN routing** (`extractAsinCandidates` in `lib/keywordMerge.ts`) —
  Auto-targeting's complements/substitutes clauses match against other
  *products*, not text, so raw ASINs sometimes show up as "search terms."
  Those are split out rather than bid on as keywords.
- **Near-duplicate collapsing** — a plural/word-order-insensitive signature
  merges near-identical candidates ("wizard school books" / "wizard schools
  book") so budget isn't split across the same idea twice.
- **Confidence scoring + bid tiering** — keywords multiple independent
  sources agree on (and Ads-API-sourced ones, which carry real bid data)
  score highest and keep their bid; single-source speculative terms get a
  discounted bid so testing them risks less spend. The list is sorted
  best-first.
- **Per-keyword match types** (`pickMatchType` in `lib/keywordMerge.ts`) —
  comparable author/title names run exact (a bare name in phrase match pulls
  in every book that mentions it), specific 3+ word phrases run phrase, and
  short generic terms run broad, where they need Amazon's expansion to find
  real queries.
- **Caps sized for research, not for one ad group** — a book's keyword list
  is reviewed and pruned by hand, so it holds up to 300 thematic keywords
  (`BOOK_KEYWORD_MAX`) plus 120 comparable names (`BOOK_COMP_NAME_MAX`).
  Amazon's own 25-50-per-ad-group guidance (`RECOMMENDED_MIN_KEYWORDS` /
  `RECOMMENDED_MAX_KEYWORDS`) applies when you carve an ad group out of that
  list, not to the list itself.
- **Thin-comp protection** (`lib/compDataValidation.ts`) — when the crawl
  found only a comp or two, the comparable-names bucket is mostly names that
  drifted in from page furniture (imprints, bookshops, unrelated authors with
  similar names). Those are dropped rather than bid on.

## AI-assisted ranking

With ~10 different free sources feeding the candidate pool (Ads API, Amazon
+ Google autocomplete, Google Books API + web scrape, Open Library, Amazon
comp-title/comp-name crawling, review-language mining, book description
mining, genre-synonym expansion, Goodreads tags), the harder problem
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

## The book page

Each book shows the metadata its keywords are generated from — cover, series,
publisher, rating, best-seller rank, Amazon's category path, and the resolved
genre vocabulary that seeds every templated keyword — alongside when it was
captured and how many data points the generator has to work with. If a
capture came back thin or blocked, the page says so and offers **Re-fetch
metadata** (`POST /api/books/[id]/refresh`), which re-runs the capture and
replaces the snapshot.

Books added before snapshots existed (or captured under an older snapshot
shape) are re-captured automatically the first time keywords are generated,
so an existing library heals itself rather than generating from metadata that
isn't there.

Optional `keyTropes` on the generate form ("enemies to lovers", "locked room
mystery") are folded in as a high-trust source and used to seed buyer-intent
templating, synonym expansion, and the AI ranking step's book context.

"Region" isn't part of this yet — a book is captured from whichever single
marketplace its link points at. Cross-marketplace comparison (does this book
rank differently on .com vs .co.uk?) would mean capturing the same ASIN
across multiple domains, which isn't built.

## Navigation

The sidebar is **Dashboard** (an overview across every book — keyword stats,
specificity distribution, top keywords by genre, recent books) → **Books**
→ **Keywords** (every keyword across every book, grouped by text, with a
Books column) → **Presets** (a managed keyword library organized by
genre/sub-genre — see below). Every section is its own route; there's no
single-page view-swapping builder anymore.

## Preset keywords by genre

`/presets` is a library of keywords organized under genres and sub-genres
you define. **Apply genre presets** on a book page (next to **Re-fetch
metadata**) matches the book's resolved genre against that library and
inserts the matching preset keywords through the same merge/dedup/filter
pipeline generation uses — presets are trusted but not exempt, so a preset
that doesn't fit a specific book still gets rejected and stays visible with
its reason, the same as any generated candidate.

Each preset keyword carries a tier: **Tier A** applies automatically; **Tier
B** is inserted paused for manual review regardless of what the filter
pipeline decides. Editing a preset keyword's text or match type propagates
to every book that applied it — unless that book's copy was hand-edited
afterward, which clears the link so propagation can never overwrite a
manual edit. Requires `sql/10-preset-keywords.sql`.

**Import starter library** on `/presets` seeds your library from a
checked-in starter set (`lib/presetSeedData/vinciKeywordBank.ts`): 9 genres,
60 sub-genres, 800 keywords, each with the comp authors it was researched
against (shown under the keyword once imported). Idempotent — re-running it
only adds what's missing, never duplicates or overwrites anything you've
since edited. Requires `sql/11-preset-keyword-author-references.sql` to keep
the author references; without it, the import still runs, just without that
extra context.

## Setup

```bash
npm install
cp .env.example .env.local   # fill in values, see below
npm run dev
```

### Environment variables

See `.env.example`. Required:

- `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY` — authentication, and the books/keywords
  tables. See "Authentication" below.
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
- `FIRECRAWL_API_KEY` — the most reliable way to read an Amazon book page
  from a cloud deployment; see "Scraping from a cloud deployment" below.

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

**Access console:** sign in as `ADMIN_EMAIL` and use the **Access** link in the
header (shown only to the admin) to approve, deny, revoke, or reinstate anyone.
Non-admins get a 404 rather than a 403, so the page's existence isn't
advertised — and the link being hidden is cosmetic, not the control: `/admin`
and its API authorize independently.

The admin flag is resolved once in the root layout and passed to the header, so
there's no client-side round-trip. The trade-off is that reading the session in
the layout opts every route into dynamic rendering — including `/login`, which
used to be static. That costs nothing in practice here, since every other route
was already dynamic and behind auth.

Revoking does two things: flips the row to `denied` (blocking new sign-in
links) *and* deletes the Supabase auth user, which invalidates any session they
currently hold. Marking the row alone would not have — `proxy.ts` validates
sessions against Supabase, not against this table, so a signed-in browser would
have kept working until its token expired. Reinstating recreates the user and
emails a fresh link. You can't revoke `ADMIN_EMAIL` from the console.

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
is scoped to full-page HTML fetches only (all of which go through the shared
rate limiter, audit log and CAPTCHA circuit breaker in `lib/fetchLog.ts`) —
**not** the autocomplete JSON
endpoints (`getAutocompleteSuggestions`), which run
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

- **Firecrawl's structured-extraction request shape** in `lib/firecrawl.ts`
  is written against the documented v1 `/scrape` contract, with a fallback to
  the `json`-format variant if that request is rejected. Both are unverified
  against a live key from this environment — check the server logs on the
  first real capture if extractions come back empty.
- **Ads API keyword-recommendations request/response shape** in
  `lib/amazonAds.ts` is written against the documented v3
  `sp/targets/keywords/recommendations` contract. Verify against the live
  OpenAPI spec once real credentials exist, before depending on it.
- **Ads API app registration status is unknown** — check the Amazon Ads
  developer console for an existing Client ID/Secret before the first
  non-mocked run.
- **Amazon and Google autocomplete scrapes are inherently fragile**
  (`lib/scrape.ts`) — both can change or block their unofficial endpoints
  without notice. Wired to fail soft (empty result), never to block a
  generate run.
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
- `cheerio` for HTML scraping
- Supabase (Postgres) for books and keywords
