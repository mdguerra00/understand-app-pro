

# Fix: quickEvidenceCheck False Positives + hasStrongConstraints Definition

## Problem Summary

Two bugs cause the constraint gate to let through queries it should block:

1. **`hasStrongConstraints` triggers on a single constraint** (e.g., just `silver_nanoparticles` alone makes it `true` because the threshold is `>= 1`). With only an additive and no material, the co-occurrence check is skipped entirely (it requires both), so individual OR checks pass and `feasible=true`.

2. **Individual checks use OR logic**: `existsInProject` checks each material and each additive independently. "Vitality" found somewhere? Pass. "Silver" found somewhere else? Pass. Both pass individually, `missing=[]`, even though they never appear together.

## Fixes

### Fix 1: Correct `hasStrongConstraints` definition

Change from `>= 1` (any single constraint) to requiring at least material+additive together:

```typescript
const hasStrongConstraints =
  (materials.length > 0 && additives.length > 0) ||
  (materials.length > 0 && properties.length > 0) ||
  (additives.length > 0 && properties.length > 0);
```

This means a single isolated additive (like `silver_nanoparticles` alone) will NOT trigger `hasStrongConstraints`. The gate only activates when there are at least 2 different constraint types present.

### Fix 2: Replace `quickEvidenceCheck` with AND-based co-occurrence logic

The current function has two stages that conflict:
- Stage 1 (lines 2112-2168): Individual OR checks per constraint type -- these always pass if the term exists anywhere
- Stage 2 (lines 2174-2201): Co-occurrence AND check -- only runs when both materials AND additives are present

**The fix**: Replace the entire function body with a unified AND-based approach:

1. When `hasStrongConstraints=true`, skip individual checks entirely
2. Go straight to co-occurrence: material+additive must appear together in the SAME experiment (title/conditions) or the SAME chunk
3. If co-occurrence fails, `feasible=false` immediately
4. For single-type constraints (shouldn't trigger strong gate after Fix 1), keep the existing `existsInProject` checks as fallback

**New `quickEvidenceCheck` logic:**

```text
if hasStrongConstraints:
  // ONLY co-occurrence matters -- skip individual checks
  if materials.length > 0 AND additives.length > 0:
    coOccurs = checkCoOccurrence(...)
    if !coOccurs: return { feasible: false, missing: ["co-ocorrencia material+aditivo"] }
  
  if materials.length > 0 AND properties.length > 0:
    // check material+property co-occur in same experiment/measurement
    ...similar logic...
  
  return { feasible: true, missing: [] }
else:
  // Weak constraints -- individual checks (existing logic)
  ...
```

### Fix 3: Ensure `checkCoOccurrence` also checks chunk-level (re-add Strategy 2 with stricter matching)

The previous fix removed chunk-level co-occurrence entirely. We should re-add it but with stricter matching -- both terms must appear in the same chunk:

```text
// Strategy 2: search_chunks -- both terms in SAME chunk (AND)
for mat in materialTerms:
  for add in additiveSearchTerms:
    query chunks WHERE chunk_text ILIKE %mat% AND chunk_text ILIKE %add%
    if found: return true
```

This is valid co-occurrence evidence (both terms in the same paragraph/section).

## Files Changed

1. `supabase/functions/rag-answer/index.ts`:
   - `extractConstraints`: Change `hasStrongConstraints` to require 2+ constraint types
   - `quickEvidenceCheck`: Rewrite to use AND-only logic when `hasStrongConstraints=true`
   - `checkCoOccurrence`: Re-add chunk-level strategy with AND matching
   - Remove individual `existsInProject` calls for strong-constraint path

## Expected Behavior After Fix

**Query: "prata na Vitality"** (material=vitality, additive=silver_nanoparticles):
- `hasStrongConstraints=true` (material + additive)
- Co-occurrence check: no experiment has both vitality AND silver/prata together
- Chunk co-occurrence: no chunk contains both terms
- `feasible=false`, `missing=["co-ocorrencia material+aditivo"]`
- Gate blocks: `pipeline_selected="fail-closed-no-evidence"`

**Query: "silver nanoparticles"** (additive only, no material):
- `hasStrongConstraints=false` (only 1 constraint type)
- Falls through to normal routing (no gate block)
- But with only chunks and no experiments, the 3-step pipeline's numerical verification will catch fabricated numbers

**Query: "resistencia flexural da Vitality com prata"** (material + additive + property):
- `hasStrongConstraints=true`
- Co-occurrence check runs for material+additive
- If no match found, `feasible=false` and gate blocks

