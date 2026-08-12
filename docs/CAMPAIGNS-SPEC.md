# Campaigns, Results & Recommendations — Implementation Spec v3

Repo: `oscarthorogood/book-keyword-generator` (package `amazon-ads-assistant`) — Next.js 16 / React 19 / Supabase / vitest
Supersedes v1 and v2. Verified against the live repo on 12 Aug 2026; corrections from that pass are marked **[verified]**.

---

## What you're building

Three things, in dependency order:

1. **Create / Update Campaign** — replace the single "Export bulksheet" button on the book page with two buttons. Create builds the 5-campaign structure from the book's keyword and ASIN bank, selecting the best targets automatically. Update diffs live state against what was last exported and emits only the rows that changed.
2. **Results upload** — drop in an Amazon Search Term Report, have it split across the 5 sub-campaigns automatically, store the history, and roll performance up onto the keyword and ASIN rows themselves so you can see how each one is doing wherever it appears in the app.
3. **Recommendations** — once real results exist, suggest bid moves, archive/reactivate calls, and BMM→Alpha Exact promotions. Accept or reject each one; download the pending set as a review CSV.

Plus a `/campaigns` section in the sidebar to see it all across books.

Everything else in this document exists to make those three work.

---

## 1. What's in the way (verified against the code, not the audit notes)

Three blockers are real. One that earlier drafts listed is already fixed. One nobody spotted will corrupt your dashboard.

### 1.1 The export isn't an uploadable Amazon file — REAL, blocks Update Campaign

**[verified]** `lib/bulksheet.ts` produces a CSV with the right idea — it already emits `Entity`, `Operation`, `Campaign Name`, `Ad Group Name`, `Match Type`, `Bid`, `Daily Budget`, `State` and builds proper Campaign → Ad Group → Keyword row hierarchies. What it's missing:

- No `Product Ad` entity row per ad group, and no SKU/ASIN column — without these Amazon has nothing to advertise.
- A custom `Source` column Amazon's importer doesn't expect.
- `Operation` is written lowercase (`"create"`); Amazon expects `Create`.
- Negative match types are written as `` `negative ${matchType}` `` → `"negative exact"`; Amazon expects `negativeExact`.

Until this is fixed, "Update Campaign" is meaningless — a diff emitting `Operation: Update` rows achieves nothing if the importer rejects the file before reading that column.

### 1.2 The old campaign trigger will overwrite your keyword counts — REAL, and previously missed

**[verified]** `sql/05-books-campaign-counts-trigger.sql` defines `sync_book_campaign_stats()` on the `campaigns` table:

```sql
campaign_count = (SELECT COUNT(*) FROM campaigns WHERE book_id = affected_book_id),
total_keywords = (SELECT COALESCE(SUM(total_rows), 0) FROM campaigns WHERE book_id = affected_book_id)
```

If that trigger and function still exist in the live database, then the moment you recreate a `campaigns` table it reattaches and starts overwriting `books.total_keywords` from campaign rows — clobbering your dashboard keyword counts. It also sums a column called `total_rows`, which this spec's schema doesn't have.

**Fix:** the first statements in the campaigns migration are
```sql
DROP TRIGGER IF EXISTS campaigns_sync_book_stats ON campaigns;
DROP FUNCTION IF EXISTS sync_book_campaign_stats();
```
and the new count trigger uses a fresh name (`sync_book_active_campaign_count`) that only touches `books.active_campaign_count`, never `total_keywords`.

### 1.3 Per-campaign negative lists — REAL, but smaller than earlier drafts claimed

**[verified]** Earlier drafts said negatives only attach to one campaign. That's stale — `lib/bulksheet.ts` carries a `§23.7` comment recording the fix, and `addNegativeRows()` is now called for every campaign it builds.

The remaining gap is different and smaller: every campaign gets the **same** list. Your safeguard needs a **different** list per campaign — Alpha Exact terms negated in BMM Discovery *only*. So the change is to make `addNegativeRows()` take a per-campaign list rather than closing over one shared array, and to tag each negative with its scope (`campaign` vs `ad_group`), since the Alpha→BMM safeguard is a campaign-level negative while starter junk terms are ad-group level.

Note also: `lib/negativeKeywords.ts` is not the file to change — it just turns filter rejections into phrase/exact candidates and is entirely campaign-unaware. Attachment lives in `lib/bulksheet.ts`.

### 1.4 `competitor_keywords` may not exist — UNVERIFIED, independent bug

Earlier rounds report that four files read/write a `competitor_keywords` table that isn't in the live database, meaning reverse-ASIN-import is broken. This needs live database access to confirm. It's unrelated to this work but sits under it — check it before trusting the schema.

### 1.5 What the current export actually builds — context for the migration

**[verified]** Today's export produces **four** campaigns, not three as earlier notes say: Descriptive – Broad/Phrase, Titles & Authors – Exact, Auto Discovery (with four auto-targeting bid multipliers), and Product Targeting. Default manual budget is **$100/day**, auto at 10% of it.

This matters because your new matrix is entirely manual — BMM Discovery is explicitly there to replace the automatic campaign. Moving to the 5-campaign structure therefore **deletes Auto Discovery**, which is currently what feeds search-term harvesting. See Decision 1.

---

## 2. Schema

Continue the existing numbering from `sql/20-`. One concern per file, each re-runnable (`IF NOT EXISTS`, `DROP ... IF EXISTS` before every `ADD CONSTRAINT` / `CREATE POLICY`), each wrapped in `BEGIN; ... COMMIT;`.

### 2.1 `campaigns` — one row per named sub-campaign

A single "Create Campaign" run inserts up to 5 rows sharing one `export_batch_id`.

```sql
DROP TRIGGER IF EXISTS campaigns_sync_book_stats ON campaigns;   -- see §1.2
DROP FUNCTION IF EXISTS sync_book_campaign_stats();

CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,

  export_batch_id UUID NOT NULL,
  campaign_type TEXT NOT NULL CHECK (campaign_type IN (
    'brand_guard', 'alpha_exact', 'bmm_discovery',
    'rival_asin_offensive', 'catalog_cross_sell'
  )),

  name TEXT NOT NULL,              -- must match the bulksheet's "Campaign Name" exactly
  amazon_campaign_id TEXT,         -- pasted back after upload; Update Campaign needs it
  operation TEXT NOT NULL DEFAULT 'create' CHECK (operation IN ('create','update')),

  daily_budget NUMERIC(10,2) NOT NULL DEFAULT 25.00 CHECK (daily_budget > 0),
  currency TEXT NOT NULL DEFAULT 'USD',        -- see Decision 2
  bidding_strategy TEXT NOT NULL DEFAULT 'dynamic_down_only'
    CHECK (bidding_strategy IN ('dynamic_up_down','dynamic_down_only','fixed')),
  top_of_search_modifier INTEGER NOT NULL DEFAULT 0 CHECK (top_of_search_modifier BETWEEN 0 AND 900),
  product_pages_modifier INTEGER NOT NULL DEFAULT 0 CHECK (product_pages_modifier BETWEEN 0 AND 900),
  start_date DATE,
  end_date DATE,

  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','exported','live','paused','archived')),

  bulksheet_path TEXT,
  bulksheet_download_url TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT campaigns_date_order CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT campaigns_unique_name_per_user UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_campaigns_user_book ON campaigns(user_id, book_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_export_batch ON campaigns(export_batch_id);
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own campaigns" ON campaigns;
CREATE POLICY "Users manage their own campaigns" ON campaigns
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

`UNIQUE (user_id, name)` is the highest-value constraint here: §5 matches imported report rows back to campaigns **by name**, so duplicate names silently mis-attribute your results.

Add the standard `updated_at` trigger, and a fresh `active_campaign_count` trigger under a new name per §1.2.

### 2.2 `campaign_targets` — what was actually exported

This is what makes Update Campaign possible. The diff needs each target's **bid and state at the moment of export**; a `keyword_ids UUID[]` column on `campaigns` (as earlier drafts had) can't store that, and gives no referential integrity.

```sql
CREATE TABLE IF NOT EXISTS campaign_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  keyword_id UUID REFERENCES keywords(id) ON DELETE SET NULL,
  competitor_asin_id UUID REFERENCES competitor_asins(id) ON DELETE SET NULL,

  target_text TEXT NOT NULL,       -- as written to the file, including any '+' BMM prefix
  match_type TEXT,                 -- broad | phrase | exact, NULL for product targeting
  targeting_expression TEXT,       -- asin="B0..." for product targets
  bid NUMERIC(10,2),
  state TEXT NOT NULL DEFAULT 'enabled' CHECK (state IN ('enabled','paused','archived')),
  operation TEXT NOT NULL DEFAULT 'Create' CHECK (operation IN ('Create','Update','Archive')),
  is_negative BOOLEAN NOT NULL DEFAULT false,
  negative_scope TEXT CHECK (negative_scope IN ('campaign','ad_group')),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_campaign ON campaign_targets(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_keyword ON campaign_targets(keyword_id);
CREATE INDEX IF NOT EXISTS idx_campaign_targets_asin ON campaign_targets(competitor_asin_id);
ALTER TABLE campaign_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own campaign targets" ON campaign_targets;
CREATE POLICY "Users manage their own campaign targets" ON campaign_targets
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### 2.3 `result_imports` + `campaign_results` — uploads that can't double-count

You will re-upload reports. Without dedupe, every re-upload doubles lifetime spend and the recommendation engine then archives keywords on numbers that never happened.

```sql
CREATE TABLE IF NOT EXISTS result_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  source_file TEXT NOT NULL,
  file_hash TEXT NOT NULL,              -- sha256 of uploaded bytes
  report_start DATE NOT NULL,
  report_end DATE NOT NULL,
  row_count INTEGER,
  matched_count INTEGER,
  unmatched_count INTEGER,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK (status IN ('processing','complete','failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (book_id, file_hash)
);

CREATE TABLE IF NOT EXISTS campaign_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  import_id UUID NOT NULL REFERENCES result_imports(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  keyword_id UUID REFERENCES keywords(id) ON DELETE SET NULL,
  competitor_asin_id UUID REFERENCES competitor_asins(id) ON DELETE SET NULL,

  campaign_name TEXT,
  ad_group_name TEXT,
  keyword_text TEXT,
  match_type TEXT,
  targeting_expression TEXT,

  report_start DATE NOT NULL,
  report_end DATE NOT NULL,

  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  spend NUMERIC(12,2) NOT NULL DEFAULT 0,
  sales NUMERIC(12,2) NOT NULL DEFAULT 0,
  orders INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',

  source_file TEXT,
  raw_row JSONB,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_results_period ON campaign_results (
  book_id, coalesce(campaign_name,''), coalesce(ad_group_name,''),
  coalesce(keyword_text,''), coalesce(match_type,''), report_start, report_end
);
CREATE INDEX IF NOT EXISTS idx_campaign_results_keyword ON campaign_results(keyword_id);
CREATE INDEX IF NOT EXISTS idx_campaign_results_asin ON campaign_results(competitor_asin_id);
CREATE INDEX IF NOT EXISTS idx_campaign_results_campaign ON campaign_results(campaign_id);
ALTER TABLE campaign_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own results" ON campaign_results;
CREATE POLICY "Users manage their own results" ON campaign_results
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

Import writes with `INSERT ... ON CONFLICT DO UPDATE`, so re-uploading a corrected report **replaces** that period instead of adding to it. `UNIQUE (book_id, file_hash)` catches the identical-file case before any parsing happens.

Note `ctr`/`cvr`/`cpc`/`acos` are deliberately **not** stored — they're pure functions of the four raw metrics and will drift. Compute them in the view below or in TypeScript.

### 2.4 Results on keywords and ASINs

This is your "results also get stored on keywords and asins for future reference" requirement. Lifetime figures are **derived**, so a re-import can never inflate them:

```sql
CREATE OR REPLACE VIEW keyword_result_rollups AS
SELECT keyword_id,
       sum(clicks) AS lifetime_clicks,
       sum(spend)  AS lifetime_spend,
       sum(sales)  AS lifetime_sales,
       sum(orders) AS lifetime_orders,
       max(report_end) AS last_report_end
FROM campaign_results WHERE keyword_id IS NOT NULL GROUP BY keyword_id;
-- equivalent view for competitor_asin_id
```

The `last_*` columns stay as a denormalised cache for fast list rendering, refreshed from the most recent period at the end of each import:

```sql
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_impressions INTEGER;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_clicks INTEGER;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_spend NUMERIC(12,2);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_sales NUMERIC(12,2);
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS last_orders INTEGER;
ALTER TABLE keywords ADD COLUMN IF NOT EXISTS results_updated_at TIMESTAMPTZ;
-- same six on competitor_asins
```

The recommendation engine reads the **view**, not the cache. If the view gets slow, make it materialised and refresh post-import — don't go back to incrementing counters.

### 2.5 Catalog Cross-Sell support

```sql
ALTER TABLE books ADD COLUMN IF NOT EXISTS series_key TEXT;
ALTER TABLE competitor_asins ADD COLUMN IF NOT EXISTS relationship TEXT
  CHECK (relationship IN ('rival','own')) DEFAULT 'rival';
```

**Do not backfill `series_key` from author name.** Doing so declares every book by an author to be one series, and Campaign 5 then spends real budget advertising your thriller on your children's book. Leave it NULL, add a control on the book page to set it (offering the author name as a *suggested* default a human accepts), and have Campaign 5 skip books where it's unset — which composes with the existing "skip campaigns with no eligible targets" rule.

Anywhere the Competitors overview assumes every row is a threat, filter to `relationship = 'rival'`.

### 2.6 Supporting changes

```sql
ALTER TABLE books ADD COLUMN IF NOT EXISTS target_acos NUMERIC DEFAULT 0.30;
ALTER TABLE books ADD COLUMN IF NOT EXISTS active_campaign_count INTEGER DEFAULT 0;

ALTER TABLE negative_keywords DROP CONSTRAINT IF EXISTS negative_keywords_source_check;
ALTER TABLE negative_keywords ADD CONSTRAINT negative_keywords_source_check
  CHECK (source IN ('starter','manual','promoted-from-rejection','search-term-report','performance-archive'));

CREATE TABLE IF NOT EXISTS keyword_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  book_id UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  keyword_id UUID REFERENCES keywords(id) ON DELETE CASCADE,
  competitor_asin_id UUID REFERENCES competitor_asins(id) ON DELETE CASCADE,
  campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL,
  type TEXT NOT NULL CHECK (type IN (
    'increase_bid','decrease_bid','archive','reactivate','pause','promote_to_alpha_exact'
  )),
  current_bid NUMERIC(10,2),
  suggested_bid NUMERIC(10,2),
  reason TEXT,
  confidence TEXT CHECK (confidence IN ('low','medium','high')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','superseded')),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_pending_rec_per_keyword_type
  ON keyword_recommendations (keyword_id, type) WHERE status = 'pending';
ALTER TABLE keyword_recommendations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users manage their own recommendations" ON keyword_recommendations;
CREATE POLICY "Users manage their own recommendations" ON keyword_recommendations
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

The partial unique index is what stops the recommendations panel filling with the same suggestion after every import.

---

## 3. The five campaigns

| # | Campaign | Targeting | Match | Count | Bidding | Placement | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Brand Guard | Manual Keyword | Exact & Phrase | 5–15 | Up and down | None | Critical (defensive) |
| 2 | Alpha Exact | Manual Keyword | Exact only | 5–10 | Up and down | Top of Search +20–50% | High (profit driver) |
| 3 | BMM Discovery | Manual Keyword | Broad with `+` | 5–10 | Down only | None | Medium (R&D) |
| 4 | Rival ASIN Offensive | Manual Product | ASIN specific | 20–40 | Down only | Product Pages +10–30% | Medium (market share) |
| 5 | Catalog Cross-Sell | Manual Product | Own ASINs | Full series | Down only | Product Pages +50% | High (read-through) |

**Broad Match Modifier is not a fourth match type.** Amazon gives you BMM through ordinary `Broad` match with `+` prefixed to mandatory words in the keyword text (`+cozy +mystery +cat`). `keywords.match_type` stays `broad`. Put `toModifiedBroadSyntax()` next to the column constants and unit-test that a `+`-prefixed keyword always exports as `broad`, so nobody later "fixes" it into an enum value.

### Safeguards, built into the flow rather than left as manual steps

- **Every Alpha Exact keyword becomes a campaign-level negative-exact in BMM Discovery** at creation time. Needs the per-campaign negative lists from §1.3.
- **Rival ASIN Offensive excludes mega-bestsellers.** Earlier drafts used `bsr < 500 AND price < 6`, which only excludes books that are *both* top-500 and cheap — a $14.99 top-10 bestseller sails straight through, exactly the target you want excluded. Make it two independent rules, configurable per genre:
  ```ts
  const DEFAULT_EXCLUSION = { maxBsr: 500, minPrice: 2.99 };
  const isMegaBestseller = (a) => a.bsr !== null && a.bsr < rules.maxBsr;
  const isRaceToBottom  = (a) => a.price !== null && a.price < rules.minPrice;
  ```
- **BMM keywords earning 3+ lifetime orders** raise a `promote_to_alpha_exact` recommendation (§6).

### Selection (`lib/campaignSelection.ts`)

Pure, deterministic, no I/O — matching the `computeCompetitorBid()` pattern in `lib/competitorBidding.ts`, so it's unit-testable and reusable from a future "reselect" bulk action. Reuse `scoreForRank()` from `lib/keywordCapAndRank.ts`; do not write a second ranking.

```ts
import { scoreForRank } from "./keywordCapAndRank";

export const CAMPAIGN_CAPS = {
  brandGuard: 15, alphaExact: 10, bmmDiscovery: 10, rivalAsin: 40,
} as const;

/** 1. Brand Guard — author/title/series/typos, Exact + Phrase. */
export function selectBrandGuardKeywords(bank: KeywordWithBook[], book: Book) {
  return dedupeByText(
    bank.filter(k =>
      ["exact", "phrase"].includes(k.match_type) &&
      (k.category === "comp-name" ||
       isAuthorOrTitleVariant(k.text, book.author, book.title) ||
       isCommonTypo(k.text, book.author))
    )
  ).slice(0, CAMPAIGN_CAPS.brandGuard);
}

/** 2. Alpha Exact — result history wins; scoreForRank breaks pre-launch ties. */
export function selectAlphaExactKeywords(bank: KeywordWithRollups[]) {
  return bank
    .filter(k => k.match_type === "exact" && k.status === "active")
    .sort((a, b) =>
      (b.lifetime_orders ?? 0) - (a.lifetime_orders ?? 0) ||
      scoreForRank(b) - scoreForRank(a) ||
      (b.specificity ?? 0) - (a.specificity ?? 0)
    )
    .slice(0, CAMPAIGN_CAPS.alphaExact);   // past ~10 Amazon's pacing starves the tail
}

/** 3. BMM Discovery — root terms, excluding anything in Alpha Exact or Brand Guard. */
export function selectBmmDiscoveryKeywords(
  bank: KeywordWithBook[], alphaExact: KeywordWithBook[], brandGuard: KeywordWithBook[]
) {
  const excluded = new Set([...alphaExact, ...brandGuard].map(k => normalizeText(k.text)));
  return bank
    .filter(k => k.match_type === "broad" && k.status === "active" &&
                 (k.specificity ?? 3) <= 2 && !excluded.has(normalizeText(k.text)))
    .slice(0, CAMPAIGN_CAPS.bmmDiscovery)
    .map(k => ({ text: toModifiedBroadSyntax(k.text), rootKeywordId: k.id }));
}

/** 4. Rival ASIN Offensive. */
export function selectRivalAsinTargets(bank: CompetitorAsin[], rules = DEFAULT_EXCLUSION) {
  return bank
    .filter(a => a.relationship === "rival" && a.status === "active" &&
                 !isMegaBestseller(a, rules) && !isRaceToBottom(a, rules))
    .sort((a, b) => (a.mean_rank ?? 999) - (b.mean_rank ?? 999))
    .slice(0, CAMPAIGN_CAPS.rivalAsin);
}

/** 5. Catalog Cross-Sell — siblings only, no cap. Empty when series_key is unset. */
export function selectCatalogCrossSellTargets(ownBooks: Book[], currentBook: Book) {
  if (!currentBook.series_key) return [];
  return ownBooks
    .filter(b => b.id !== currentBook.id && b.series_key === currentBook.series_key && b.asin)
    .map(b => ({ asin: b.asin!, relationship: "own" as const }));
}
```

---

## 4. Create & Update Campaign

Replace the single export action in `KeywordManager.tsx` / `CompetitorPanel.tsx`:

```tsx
<div className="action-card-row">
  <button onClick={handleCreateCampaign} className="action-card action-card-secondary">
    <Rocket size={20} /><span className="text-md font-semibold">Create campaign</span>
  </button>
  <button onClick={handleUpdateCampaign} disabled={!hasExportedCampaign}
          className="action-card action-card-secondary">
    <RefreshCw size={20} /><span className="text-md font-semibold">Update campaign</span>
  </button>
</div>
```

### Create — `POST /api/books/[id]/campaigns`

1. Load the book's bank (`keywords`, `competitor_asins`) plus sibling books sharing `series_key`.
2. Run the five selection functions.
3. Build the per-campaign negative lists, including Alpha Exact → BMM negative-exacts.
4. Generate one `export_batch_id`; build one bulksheet across all five sub-campaigns.
5. Insert one `campaigns` row per sub-campaign **that has eligible targets** — skip empty ones rather than creating a $25/day campaign with nothing in it (a standalone title with no siblings simply has no Catalog Cross-Sell). Insert `campaign_targets` rows capturing bid and state as exported.
6. Show the **total daily spend commitment** before the final confirm, and require explicit confirmation above a threshold.
7. Upload to the existing `bulksheets` bucket, then flip `status` from `draft` to `exported` in one update. Only `exported` campaigns appear in the Update picker — this is what stops a failed Storage upload leaving five campaigns pointing at a file that doesn't exist.
8. Prompt for `amazon_campaign_id` per sub-campaign, and keep a persistent "needs Amazon ID" badge on `/campaigns` until it's filled. Update Campaign is blocked without it, with a message saying exactly why.

### Update — `PATCH /api/books/[id]/campaigns/[campaignId]`

1. Pick which sub-campaign to update, grouped by most recent `export_batch_id`, labelled by `campaign_type`.
2. Diff `campaign_targets` (last exported batch) against live `keywords` / `competitor_asins`, joined **by id, never by text** — the same text can exist as several rows across match types.
   - In snapshot, active, bid or state changed → `Operation: Update`
   - Not in snapshot, now active → `Operation: Create`
   - In snapshot, now archived or negative → `Operation: Archive`
   - In snapshot, active, **nothing changed → emit no row at all.** A file full of no-op Update rows is how you reset bids Amazon has spent weeks optimising.
3. Extend the existing bulksheet builder with an `operation` parameter per row — don't fork a second builder.
4. Insert a new `campaigns` row with `operation: 'update'`, the same `amazon_campaign_id`, a new `export_batch_id`.

---

## 5. Results upload

**Extend `lib/searchTermImport.ts`; do not add a second parser.** It already parses Search Term Report CSVs via `parseSearchTermReportRows()` for keyword discovery and negative suggestions. A report row already carries the parent keyword identity (`Targeting` / keyword id / match type) alongside the search term and metrics — the current parser just discards it. Capture it, and one weekly upload feeds discovery, negatives *and* performance.

Flow:
1. Hash the file; reject an exact re-upload of the same file for the same book up front.
2. Insert `result_imports` as `processing` and **return immediately** — then process in chunks. A book with months of history produces tens of thousands of rows; don't gamble on a serverless timeout. Poll from the UI via `GET /api/books/[id]/results/imports/[importId]`.
3. Derive `report_start` / `report_end` from the file; if absent, require the user to pick the range in the upload modal. Never default to today — every rollup depends on it.
4. Pre-load the book's keywords and ASINs into an in-memory map **once**, not a query per row.
5. Aggregate rows by parent keyword within the book, then match: keywords by `(book_id, text, match_type)`, product targets by ASIN, and `campaign_name` → `campaigns.id`. That last match is what splits one file across your five sub-campaigns automatically, since each has a distinct name.
6. Write `campaign_results` in multi-row `INSERT ... ON CONFLICT DO UPDATE` batches.
7. Refresh the `last_*` cache on matched keywords and ASINs.
8. Unmatched rows — genuinely new search terms — keep flowing into the existing discovery and negative-suggestion pipeline unchanged. Store them and report the count; never fail an import over them. A persistent unmatched list is how you notice a campaign got renamed in Amazon and quietly stopped matching.

---

## 6. Recommendations (`lib/recommendations.ts`)

Post-launch and deliberately separate from the pre-launch estimators (`computeCompetitorBid()`, generation-time `suggestedBid` tiering). Reuses `clampBid()` / `DEFAULT_COMPETITOR_BID_RANGE` from `lib/amazonAds.ts` so it can never propose a bid outside the sane range, and never fires before a row has real results.

Four rules that matter:

- **One window per rule, named.** Archive decisions use **lifetime** clicks *and* **lifetime** orders. Bid moves use the **last period**. Mixing them — lifetime clicks against last-period orders — archives a keyword with 40 clicks and 6 lifetime orders that simply had a quiet week, at `confidence: 'high'`.
- **Return `Recommendation[]`, not one or null.** Collect everything applicable and sort by severity; an early-return chain means the first rule wins by accident of ordering.
- **Read `books.target_acos`**, not a hardcoded 30%.
- **Cooldown.** After a rejection, suppress that `type` for that entity for 30 days. Regeneration supersedes pending rows rather than duplicating them.

```ts
const MIN_CLICKS_FOR_BID_CHANGE = 20;
const MIN_CLICKS_FOR_ARCHIVE = 30;

export function recommendForKeyword(kw: KeywordWithRollups, targetAcos: number): Recommendation[] {
  if (!kw.results_updated_at) return [];          // no opinion before real data
  const out: Recommendation[] = [];

  if (kw.campaignType === "bmm_discovery" && (kw.lifetime_orders ?? 0) >= 3) {
    out.push({ keywordId: kw.id, type: "promote_to_alpha_exact", confidence: "high",
      reason: `${kw.lifetime_orders} orders from BMM Discovery — meets the 3-sale promotion rule` });
  }

  const lifetimeClicks = kw.lifetime_clicks ?? 0;
  const lifetimeOrders = kw.lifetime_orders ?? 0;

  if (lifetimeClicks >= MIN_CLICKS_FOR_ARCHIVE && lifetimeOrders === 0 && (kw.lifetime_spend ?? 0) > 0) {
    out.push({ keywordId: kw.id, type: "archive", currentBid: kw.bid, confidence: "high",
      reason: `${lifetimeClicks} clicks, ${fmt(kw.lifetime_spend)} spend, 0 orders lifetime` });
  }

  const acos = computeAcos(kw.last_spend, kw.last_sales);
  if (lifetimeClicks >= MIN_CLICKS_FOR_BID_CHANGE && acos !== null && kw.bid !== null) {
    if (acos > targetAcos * 1.33) {
      out.push({ keywordId: kw.id, type: "decrease_bid", currentBid: kw.bid,
        suggestedBid: clampBid(kw.bid * 0.8, DEFAULT_COMPETITOR_BID_RANGE), confidence: "high",
        reason: `ACOS ${pct(acos)} vs target ${pct(targetAcos)}` });
    } else if (acos < targetAcos * 0.67 && (kw.last_orders ?? 0) > 0) {
      out.push({ keywordId: kw.id, type: "increase_bid", currentBid: kw.bid,
        suggestedBid: clampBid(kw.bid * 1.2, DEFAULT_COMPETITOR_BID_RANGE), confidence: "medium",
        reason: `ACOS ${pct(acos)} well under target` });
    }
  }
  return out;
}
```

Apply the same shape to `competitor_asins` for product-targeting recommendations.

**Two accept paths for `archive`**, mirroring your existing status distinction:
- *Archive only* → `status = 'archived'` (reversible pause).
- *Archive and block* → `status = 'negative'` plus an insert into `negative_keywords` with `source: 'performance-archive'` — the same mechanism as your existing promote-to-negative button, triggered by performance instead of the filter pipeline.

**`promote_to_alpha_exact` gets its own confirmation step**, not a one-click accept: it inserts the term as Exact in Alpha Exact, negative-exacts it in BMM Discovery, and archives the BMM row. Three campaigns move at once.

Start the thresholds conservative. A wrong archive on a keyword that hasn't had time to convert costs more than a slow engine.

---

## 7. Pages and routes

Sidebar entry in `AppShell.tsx`:
```tsx
{ href: "/campaigns", label: "Campaigns", icon: Megaphone },
```

| Route | Purpose |
|---|---|
| `/campaigns` | Cross-book list — name, book, type, status, last export, last import, ACOS/spend. Grouped by `export_batch_id`. |
| `/campaigns/[id]` | One sub-campaign: export history, results, scoped recommendations. |
| `POST /api/books/[id]/campaigns` | Create |
| `PATCH /api/books/[id]/campaigns/[campaignId]` | Update |
| `POST /api/books/[id]/results/import` | Upload a Search Term Report |
| `GET /api/books/[id]/results/imports/[importId]` | Poll import status |
| `GET /api/books/[id]/recommendations` | Pending recommendations |
| `POST /api/books/[id]/recommendations/[recId]/accept` | Apply and mark accepted |
| `POST /api/books/[id]/recommendations/[recId]/reject` | Mark rejected, start cooldown |
| `GET /api/books/[id]/recommendations/export` | Review CSV of pending recs — explicitly not an upload file |

Components: `CampaignsOverviewPage.tsx`, `CampaignDetailPage.tsx`, `ResultsUploadModal.tsx`, `RecommendationsPanel.tsx` (reusable — book detail, campaign detail, and a global pending view), following the cross-book rollup pattern in `AllKeywordsPage.tsx` / `CompetitorsOverviewPage.tsx` / `SourcesPage.tsx`.

---

## 8. Build order

One PR per row. Each ships green (`npm run validate`) and is independently revertible.

| PR | Scope | Blocked by |
|---|---|---|
| 0 | Preflight: confirm the live-DB unknowns (§1.2 trigger state, §1.4 `competitor_keywords`, migration drift, Storage bucket, account currency). Write `docs/CAMPAIGNS-PREFLIGHT.md`. No code. | — |
| 1 | `competitor_keywords` corrective migration, if PR 0 confirms drift | 0 |
| 2 | Extract the bulksheet column contract: promote the existing `BULKSHEET_COLUMNS` into `lib/bulksheetSchema.ts` with entity/operation types and row builders. No behaviour change. | 0 |
| 3 | Prerequisite A: Product Ad rows, SKU/ASIN column, drop the custom `Source` column, fix `Operation` and negative match-type casing. Two outputs: `*-review.csv` (unchanged, the audit trail) and `*-upload.xlsx` via `exceljs`, already a dependency. | 2 |
| 3.5 | **Human gate** — upload a generated file to Amazon in draft and confirm it's accepted. Claude Code cannot do this. Prerequisite A isn't closed until you have. | 3 |
| 4 | Per-campaign negative lists with `campaign`/`ad_group` scope (§1.3) | 2 |
| 5 | Migrations §2, one concern per file, **trigger drop first** | 1 |
| 6 | `lib/campaignSelection.ts` + unit tests. Pure, no I/O, no UI. | 5 |
| 7 | Create Campaign end-to-end | 3.5, 4, 6 |
| 8 | Results import: parser extension, job table, matching, rollups | 5 |
| 9 | Update Campaign + diff | 7, 8 |
| 10 | Recommendation engine, accept/reject UI, review CSV | 8 |
| 11 | `/campaigns`, `/campaigns/[id]`, sidebar | 7 |

Until PR 3.5 passes, UI copy stays honest: "Download campaign plan", not "Upload to Amazon".

---

## 9. How Claude Code should work through this

### Repo rules to load first

- `CLAUDE.md` is just `@AGENTS.md`. `AGENTS.md` carries a generated block warning that **this is Next.js 16 and it differs from training data** — read `node_modules/next/dist/docs/` before writing any route or component. Don't delete that block from a diff; if `next dev` re-adds it, commit it.
- Done means `npm run validate` passes (lint + `tsc --noEmit` + `vitest run`) and CI is green. Run `npm run format` before committing.
- Never edit `node_modules`. Never commit `.env` — `.env.example` is the only env file.

### Guardrails

- **No schema change without a numbered file in `sql/`.** Write `sql/NN-name.sql`; a human applies it. Migration files are append-only — never edit an applied one.
- **No destructive SQL** without explicit sign-off. §2.5 exists because an earlier draft contained a silent `UPDATE books SET series_key = ...` across every row.
- **One PR per build-order row.** Over ~400 changed lines outside tests, stop and split.
- **Tests first for pure logic** — `campaignSelection.ts`, `recommendations.ts`, `bulksheetSchema.ts`. Follow the existing 24 test files.
- **Reuse, don't reinvent:** `scoreForRank()`, `clampBid()`, `DEFAULT_COMPETITOR_BID_RANGE`, `computeCompetitorBid()`, `parseSearchTermReportRows()`, `BULKSHEET_COLUMNS`. If one doesn't match this spec's assumption, stop and report rather than writing a parallel version.

### Stop and ask when

- A PR 0 finding changes the design.
- A task needs an already-applied migration edited.
- Amazon's template shape can't be confirmed from a real export.
- Credentials or a live Amazon account are needed.
- The spec contradicts the code. **The code wins** — but say so, and fix the spec in the same PR.

### Task prompt shape

```
Task: <build-order row>
Spec: docs/CAMPAIGNS-SPEC.md §<n> only.
Read first: <3-6 named files>
Out of scope: <the adjacent thing it'll be tempted to touch>
Acceptance criteria:
  - <observable behaviour>
  - npm run validate passes
  - tests: <named file, named cases>
Branch: feat/campaigns-<slug>
When done: draft PR, plus anything that contradicted the spec.
```

The "read first" line does the most work here. Point at the repo and hope, and you get a sixty-file diff.

### Keeping it alive

Commit this as `docs/CAMPAIGNS-SPEC.md` so sections can be referenced by number. Add `docs/CAMPAIGNS-PROGRESS.md` — the §8 table with checkboxes, updated in the same PR as the work. A spec that drifts from the code is worse than none, because agents believe it.

---

## 10. Decisions needed from you

1. **Auto Discovery.** Today's export builds four campaigns including an Auto Discovery one with four auto-targeting bid multipliers — currently what feeds your search-term harvesting. The new matrix is all-manual, with BMM Discovery explicitly replacing it. Drop Auto entirely, or keep it as an optional sixth campaign? *Recommendation: keep it, optional and off by default, until BMM Discovery has proven it surfaces comparable search terms.*
2. **Budget.** `lib/bulksheet.ts` currently defaults manual campaigns to $100/day; the matrix says $25/day × 5 = $125/day. Make the per-campaign figure an input, default the five to a total you set and split proportionally, with a typed confirmation above a threshold. What's the threshold?
3. **Currency and marketplace.** The code writes `$`; the schema above defaults to USD. Confirm from a real report export.
4. **`series_key`.** Manual per book, ISBN prefix, or title-pattern matching?
5. **Target ACOS.** Flat 30% default, or derive break-even from royalty per unit where the book record has price and royalty?
6. **Rival exclusion thresholds.** Confirm `maxBsr: 500` and `minPrice: 2.99` as the genre-tunable defaults.
7. **Recommendation cooldown.** 30 days after rejection, or shorter?
