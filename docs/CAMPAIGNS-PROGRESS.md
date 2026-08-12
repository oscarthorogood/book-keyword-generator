# Campaigns Build Progress

Tracks `docs/CAMPAIGNS-SPEC.md` §8's build order. Update in the same PR as the work it reflects.

All rows currently ship as commits on PR [#42](https://github.com/oscarthorogood/book-keyword-generator/pull/42) (branch `claude/campaigns-preflight-verify-ezmvos`), by user decision rather than one branch per row.

- [x] **PR 0** — Preflight: confirm live-DB unknowns, write `docs/CAMPAIGNS-PREFLIGHT.md`. No code.
- [x] **PR 1** — `competitor_keywords` corrective migration (`sql/20-fix-competitor-keywords-drift.sql`). Also bundled the `sql/19` source-check drift found in the same audit, by user decision.
- [x] **PR 2** — Extracted the bulksheet column contract into `lib/bulksheetSchema.ts` (columns, row type, `PRODUCT`, `toCsv`, and one pure builder per entity: campaign/ad group/keyword/negative/product-targeting). `lib/bulksheet.ts` now calls these instead of building rows inline. No behaviour change — `tests/listingPipeline.test.ts`'s existing row/CSV assertions pass unchanged, plus 8 new tests in `tests/bulksheetSchema.test.ts`.
- [x] **PR 3** — Prerequisite A, split into 3a/3b for diff size. 3a: `lib/bulksheetSchema.ts` upload row builders (Product Ad entity/SKU, `Operation: "Create"`, camelCase negative match types, no `Source` column) — minimal fix for the 4 named bugs, not full template parity. 3b: `lib/bulksheetUpload.ts` (`buildUploadRows`, mirrors the review assembly logic without touching it) + `lib/bulksheetXlsx.ts` (`exceljs` renderer) + both export routes now accept `?format=upload`. Review CSV unchanged in content; filename suffix changed `-bulksheet.csv` → `-review.csv` to name it explicitly as the audit-trail half of the pair.
- [ ] **PR 3.5** — Human gate: upload a generated file to Amazon in draft, confirm accepted. *(Not automatable — needs a human with Amazon Ads access. PR 3's format is best-effort/documented, not verified against a real export — this is the step that verifies it.)*
- [ ] **PR 4** — Per-campaign negative lists with `campaign`/`ad_group` scope.
- [ ] **PR 5** — Migrations §2 (campaigns, campaign_targets, result_imports, campaign_results, rollup views, series_key/target_acos/keyword_recommendations), trigger drop first.
- [ ] **PR 6** — `lib/campaignSelection.ts` + unit tests.
- [ ] **PR 7** — Create Campaign end-to-end.
- [ ] **PR 8** — Results import: parser extension, job table, matching, rollups.
- [ ] **PR 9** — Update Campaign + diff.
- [ ] **PR 10** — Recommendation engine, accept/reject UI, review CSV.
- [ ] **PR 11** — `/campaigns`, `/campaigns/[id]`, sidebar.

## Open decisions (spec §10) — not yet answered

1. Auto Discovery: drop, or keep as optional sixth campaign?
2. Budget: per-campaign figure as input, total split proportionally — confirm threshold for the typed confirmation.
3. Currency/marketplace: confirm from a real report export. Note: `lib/bulksheet.ts` does not actually hardcode a `$`/`£` symbol anywhere (checked directly) — bids/budgets are unitless `.toFixed(2)` strings. Live book data is 100% `marketplace = 'UK'` (4/4 rows) though the `books.marketplace` column default is `'US'`.
4. `series_key`: manual, ISBN prefix, or title-pattern?
5. Target ACOS: flat 30%, or derive break-even from royalty per unit?
6. Rival exclusion thresholds: confirm `maxBsr: 500`, `minPrice: 2.99`.
7. Recommendation cooldown: 30 days, or shorter?

PRs 5, 7, and 10 touch schema/behaviour that depends on decisions 2-7 — will stop and ask inline if reached before these are answered, per the spec's own guardrails.
