# Competitor-ASIN Bid Decision System

Implements task 2 of the competitor-ASIN enhancements: a pure, deterministic
bid calculation for `competitor_asins.bid` (the per-ASIN product-targeting
bid used by the bulksheet export, `sql/16-competitor-asin-status-parity.sql`).

## Where it lives

- `lib/competitorBidding.ts` — `computeCompetitorBid(signals, options?)`, the
  pure scoring function. No I/O, no Supabase — easy to unit test and safe to
  call from anywhere.
- `lib/amazonAds.ts` — `DEFAULT_COMPETITOR_BID_RANGE` and `clampBid()`, the
  bid-range clamp shared with (and named after) the Ads API client, so a
  future live bid-range lookup (`RawRecommendation.bid.rangeStart/rangeEnd`)
  can replace the default without touching the bidding logic itself.

## Signals

`computeCompetitorBid` reads four optional signals off a `competitor_asins`
row, all captured by the Generate ASINs flow
(`sql/17-competitor-asin-metadata.sql`):

| Signal | Source | Intuition |
|---|---|---|
| `bsr` | `scrapeProductPage` (lib/scrape.ts) | Lower BSR = stronger-selling competitor = a more valuable product-targeting placement. |
| `price` | `scrapeProductPage` | A pricier comp implies a reader base willing to spend more. Small nudge only. |
| `competitorCount` | Generate ASINs discovery-source count | More discovery sources agreeing on the ASIN = more confidence it's a real, relevant competitor. |
| `meanRank` | Generate ASINs average discovery position | A lower average position means the ASIN surfaced early/prominently across sources. |

Each signal maps to a small integer tier (0-3); the four tiers sum to a
0-10 "confidence total," which linearly scales a multiplier from 0.85x (no
signal) to 1.6x (maximum signal) applied to a base bid (default **$0.50**,
matching the keyword pipeline's default). The result is clamped to
`DEFAULT_COMPETITOR_BID_RANGE` ($0.20-$2.50) via `clampBid()`.

This mirrors `bidTier()`'s tiering pattern in `lib/keywordCapAndRank.ts`
(small integer tiers → multiplier → final bid) rather than inventing a new
shape.

## Call sites

1. **Generation time** — `app/api/books/[id]/competitors/generate/route.ts`
   fetches minimal metadata for each newly discovered ASIN, then calls
   `computeCompetitorBid()` once per new row before insert.
2. **Bulk "Recalculate bids"** — `POST /api/books/[id]/competitors/recalculate-bids`
   (body: `{ ids?: string[] }`, omit `ids` to recompute every tracked ASIN)
   re-scores existing rows from their already-stored metadata — no re-fetch.
   Wired into `CompetitorPanel.tsx` as both a primary action card and a
   bulk-selection toolbar action.

Manual bid edits (inline editing in the manager table, `PATCH
/api/competitors/[id]`) are untouched by either call site — recalculating
bids always overwrites with the computed value, same as the keyword
pipeline's own `suggestedBid` recompute behavior.
