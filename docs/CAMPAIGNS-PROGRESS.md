# Campaigns Build Progress

Tracks `docs/CAMPAIGNS-SPEC.md` §8's build order. Update in the same PR as the work it reflects.

All rows currently ship as commits on PR [#42](https://github.com/oscarthorogood/book-keyword-generator/pull/42) (branch `claude/campaigns-preflight-verify-ezmvos`), by user decision rather than one branch per row.

- [x] **PR 0** — Preflight: confirm live-DB unknowns, write `docs/CAMPAIGNS-PREFLIGHT.md`. No code.
- [x] **PR 1** — `competitor_keywords` corrective migration (`sql/20-fix-competitor-keywords-drift.sql`). Also bundled the `sql/19` source-check drift found in the same audit, by user decision.
- [x] **PR 2** — Extracted the bulksheet column contract into `lib/bulksheetSchema.ts` (columns, row type, `PRODUCT`, `toCsv`, and one pure builder per entity: campaign/ad group/keyword/negative/product-targeting). `lib/bulksheet.ts` now calls these instead of building rows inline. No behaviour change — `tests/listingPipeline.test.ts`'s existing row/CSV assertions pass unchanged, plus 8 new tests in `tests/bulksheetSchema.test.ts`.
- [x] **PR 3** — Prerequisite A, split into 3a/3b for diff size. 3a: `lib/bulksheetSchema.ts` upload row builders (Product Ad entity/SKU, `Operation: "Create"`, camelCase negative match types, no `Source` column) — minimal fix for the 4 named bugs, not full template parity. 3b: `lib/bulksheetUpload.ts` (`buildUploadRows`, mirrors the review assembly logic without touching it) + `lib/bulksheetXlsx.ts` (`exceljs` renderer) + both export routes now accept `?format=upload`. Review CSV unchanged in content; filename suffix changed `-bulksheet.csv` → `-review.csv` to name it explicitly as the audit-trail half of the pair.
- [ ] **PR 3.5** — Human gate: upload a generated file to Amazon in draft, confirm accepted. *(Not automatable — needs a human with Amazon Ads access. PR 3's format is best-effort/documented, not verified against a real export — this is the step that verifies it.)*
- [x] **PR 4** — `NegativeKeyword.scope` (`campaign`/`ad_group`, defaults `ad_group`), new `Campaign Negative Keyword` entity/builders in `lib/bulksheetSchema.ts`, and both `addNegativeRows` (review + upload) route by scope. `lib/negativeKeywords.ts` untouched (stays campaign-unaware) per spec §1.3.
- [x] **PR 5** — Migrations `sql/21`-`26`, one concern per file, trigger drop first (fixed via `DROP FUNCTION ... CASCADE` rather than a `DROP TRIGGER ... ON campaigns` that would fail pre-table-creation). Not applied to Supabase — needs a human to run them. Schema reflects the §10 decisions above (currency columns have no `DEFAULT`, $25 budget, 30% ACOS).
- [x] **PR 6** — `lib/campaignSelection.ts`: five pure selection functions + `toModifiedBroadSyntax`, reusing `scoreForRank()`. Both spec-named bug fixes applied (Brand Guard filter-before-slice, independent mega-bestseller/race-to-bottom rules). One spec/code contradiction fixed (code wins): `"comp-name"` is a `KeywordSource`, not `KeywordCategory`.
- [ ] **PR 7** — Create Campaign end-to-end.
- [x] **PR 8** — Results import, split 8a/8b. 8a: `lib/searchTermImport.ts` now captures campaignName/adGroupName/targeting/matchType/impressions/sales (previously discarded); new `lib/resultsMatching.ts` (`aggregateByTarget` + `matchResultRows`), pure. 8b: `POST /api/books/[id]/results/import` (multipart, sha256 dedupe, batched upsert, last_* cache refresh) + `GET .../imports/[importId]` poll route. New `lib/csv.ts` (no CSV dep existed) and `lib/marketplaceCurrency.ts` (resolves decision 3, reusable by PR 7). **Architecture deviation from spec** (confirmed with user): processed synchronously within `maxDuration=60`, not a real background job — this codebase has no queue infra, every other long-running route uses this same pattern. Also corrected `sql/23`'s unique index (was `coalesce(...)`-based, unusable by Supabase-js's `.upsert`) since it wasn't yet applied.
- [ ] **PR 9** — Update Campaign + diff.
- [ ] **PR 10** — Recommendation engine, accept/reject UI, review CSV.
- [ ] **PR 11** — `/campaigns`, `/campaigns/[id]`, sidebar.

## Open decisions (spec §10) — resolved

1. **Auto Discovery**: keep, optional and off by default (spec's own recommendation).
2. **Budget**: $25/campaign default (≈$125/day total across 5), typed confirmation required above $50/day.
3. **Currency/marketplace**: per-book, derived from `books.marketplace` at write time — no hardcoded schema default (`campaigns.currency`/`campaign_results.currency` are `NOT NULL` with no `DEFAULT`, forcing every insert to supply it explicitly).
4. **`series_key`**: manual per book; UI suggests author name as a default, human confirms/edits (spec §2.5's own recommendation).
5. **Target ACOS**: flat 30% default (`books.target_acos NUMERIC DEFAULT 0.30`).
6. **Rival exclusion thresholds**: `maxBsr: 500`, `minPrice: 2.99` (spec's own defaults).
7. **Recommendation cooldown**: 30 days after rejection.
