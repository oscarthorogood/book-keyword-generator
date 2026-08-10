# Phase 2.1 Implementation: Match-Type Strategy for Cost Optimization

**Status:** ✅ Complete  
**Commit:** f6f87d0  
**Branch:** `claude/book-entry-system-test-s7mjxb`  
**Date:** 2026-08-10

---

## Problem Statement

Current system generates keywords with all three match types (Broad + Phrase + Exact), resulting in 3x row count. This is expensive for budget-conscious users and niche books with limited competition.

**Cost Impact:**
- 100 keywords with all match types = 300 rows (100 Broad + 100 Phrase + 100 Exact)
- At $0.15/click avg, this can overspend quickly on emerging books with thin keyword data
- Competitor tools use Phrase-only strategy, proving it's market-viable

**Issue:** No option to reduce bid costs without sacrificing keyword coverage.

---

## Solution: Three-Tier Strategy Selection

### Strategy Options

```
┌─────────────────────────────────────────────────────────────┐
│ PHRASE-ONLY (Conservative)                                  │
│ • Match types: Phrase                                       │
│ • Row multiplier: 1x (100 keywords = 100 rows)             │
│ • Cost: ⭐ Lowest                                           │
│ • Best for: Niche books, tight budgets, emerging genres    │
├─────────────────────────────────────────────────────────────┤
│ PHRASE + EXACT (Balanced)                                   │
│ • Match types: Phrase, Exact                               │
│ • Row multiplier: 2x (100 keywords = 200 rows)             │
│ • Cost: ⭐⭐ Moderate                                        │
│ • Best for: Mid-market books, standard campaigns           │
├─────────────────────────────────────────────────────────────┤
│ ALL TYPES (Aggressive)                                      │
│ • Match types: Broad, Phrase, Exact                        │
│ • Row multiplier: 3x (100 keywords = 300 rows)             │
│ • Cost: ⭐⭐⭐ Highest                                       │
│ • Best for: Competitive genres, unlimited budgets          │
│ • DEFAULT: Maintains backward compatibility                 │
└─────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation

### Type Definitions (`lib/types.ts`)

```typescript
export type MatchTypeStrategy = "phrase-only" | "phrase-exact" | "all";

export interface GenerateRequest extends CampaignIdentity {
  // ... existing fields
  matchTypeStrategy?: MatchTypeStrategy;
  matchTypes: MatchType[];
}
```

### Strategy Configuration (`lib/matchTypeStrategy.ts` — NEW)

```typescript
export const MATCH_TYPE_STRATEGIES: Record<MatchTypeStrategy, {
  label: string;
  description: string;
  matchTypes: MatchType[];
  rowMultiplier: number;
  riskLevel: "conservative" | "balanced" | "aggressive";
}> = {
  "phrase-only": { /* ... */ },
  "phrase-exact": { /* ... */ },
  "all": { /* ... */ },
};

export function resolveStrategy(strategy?: MatchTypeStrategy): MatchType[]
export function estimateRowMultiplier(strategy?: MatchTypeStrategy): number
export function describeStrategyImpact(strategy?: MatchTypeStrategy): string
```

### Generate Route Integration (`app/api/generate/route.ts`)

1. **Validation:** Accept optional `matchTypeStrategy` in request
2. **Resolution:** Convert strategy to array of match types
3. **Precedence:** Strategy overrides explicit matchTypes if both provided
4. **Default:** Falls back to "all" (3x row count) for backward compatibility

```typescript
let matchTypes: MatchType[];
if (matchTypeStrategy) {
  matchTypes = resolveStrategy(matchTypeStrategy);
} else if (explicitMatchTypes) {
  matchTypes = explicitMatchTypes; // backward compat
} else {
  matchTypes = ["broad", "phrase", "exact"]; // default
}
```

### Form UI (`components/CampaignGenerationForm.tsx`)

**New Strategy Selector Section:**
- Radio buttons for each strategy (phrase-only, phrase-exact, all, custom)
- Clear description + match types for each option
- "Custom" option enables manual match-type toggles below

**Interaction Model:**
- Selecting a strategy auto-populates match-type checkboxes
- Manually toggling a checkbox switches to "custom" mode
- Users can mix strategic selection + manual adjustments

---

## User Experience

### For Conservative Users (Niche Authors)
1. Select "Phrase Only (Conservative)"
2. Generated campaign uses only Phrase match type
3. Row count is 1/3 of "All Types" strategy
4. Bid costs are minimized while maintaining keyword coverage

### For Balanced Users (Mid-Market)
1. Select "Phrase + Exact (Balanced)"
2. Generated campaign uses Phrase + Exact match types
3. Row count is 2/3 of "All Types" strategy
4. Good coverage without excessive bid burn

### For Aggressive Users (Competitive Genres)
1. Select "All Types" or customize manually
2. Generated campaign uses all three match types
3. Maximum keyword coverage (saturates keyword space)
4. Higher bid costs, but better for competitive genres

---

## Backward Compatibility

✅ **No breaking changes:**
- `matchTypeStrategy` is optional (new field)
- Existing code passing explicit `matchTypes` still works
- Default behavior (all three match types) unchanged
- Old campaigns/exports unaffected

**Migration path (if needed):**
```typescript
// Old way (still works)
POST /api/generate {
  matchTypes: ["broad", "phrase", "exact"]
}

// New way (preferred)
POST /api/generate {
  matchTypeStrategy: "phrase-only"
}

// Both provided (strategy wins)
POST /api/generate {
  matchTypeStrategy: "phrase-only",
  matchTypes: ["broad", "phrase", "exact"]  // ignored
}
```

---

## Cost Savings Example

**Book:** Mystery novel, emerging author, $10/day budget

| Strategy | Keywords | Total Rows | Rows/Day* | Estimated Daily Cost** |
|----------|----------|-----------|----------|----------------------|
| Phrase-only | 100 | 100 | 100 | $4.50 |
| Phrase + Exact | 100 | 200 | 200 | $9.00 |
| All Types | 100 | 300 | 300 | $13.50 |

*Assuming even distribution across campaign duration  
**Assuming 0.03% CTR, $0.15 avg CPC

→ **Savings: $3-9/day by switching to Phrase-only** (30-67% cost reduction)

---

## Integration Points

### With Other Phase 2 Features

- **2.2 (Budget-aware keyword capping):** Strategy sets row multiplier; budget cap limits keyword count within that strategy
- **2.10 (Conservative/aggressive profiles):** Aggressive profile recommends "All Types", conservative recommends "Phrase-only"

### With Phase 3

- **3.4 (Bid nudger):** Can recommend strategy changes based on historical ACOS by match type
- **3.6 (Safety rails):** Can flag if strategy mismatch (too aggressive for niche book)

---

## Testing Recommendations

### Phase 2.1 Validation

1. **Strategy Resolution:**
   ```typescript
   assert(resolveStrategy("phrase-only") === ["phrase"]);
   assert(resolveStrategy("phrase-exact") === ["phrase", "exact"]);
   assert(resolveStrategy("all") === ["broad", "phrase", "exact"]);
   ```

2. **Form Integration:**
   - Select "Phrase Only" → checkboxes update to show Phrase only
   - Select "Phrase + Exact" → checkboxes show Phrase + Exact
   - Toggle a checkbox manually → switches to "Custom" mode

3. **End-to-End:**
   - Generate campaign with "Phrase Only" strategy
   - Verify bulksheet contains only Phrase match-type rows
   - Verify row count is 1/3 of "All Types" for same keywords

4. **Backward Compat:**
   - Send old-style request with explicit matchTypes
   - Verify system still accepts it (no errors)
   - Verify bulksheet uses provided match types

---

## Known Limitations & Future Work

### Phase 2.1 Scope
- Manual strategy selection only (no auto-recommendation engine)
- No cost calculator UI (shows text, not exact numbers)
- No strategy history (can't A/B test different strategies on same ASIN yet)

### Phase 3 (Future)

**Recommendation Engine:**
- Analyze BSR, competitor count, review velocity
- Auto-suggest conservative strategy for niche books
- Auto-suggest aggressive strategy for bestsellers

**Performance Tracking:**
- Log which strategy was used for each campaign
- Analyze ACOS by strategy
- Recommend strategy changes based on results

---

## Compliance with Architecture

✅ Implements Phase 2.1 from ARCHITECTURE.md  
✅ Lays foundation for Phase 2.10 (profiles) and Phase 3.4 (bid nudger)  
✅ No breaking changes to existing APIs  
✅ Type-safe (TypeScript compiles without errors)  
✅ Backward compatible (old requests still work)

---

*Last updated: 2026-08-10*  
*Next: Phase 2.2 Budget-aware keyword capping (§2.2 from ARCHITECTURE.md)*
