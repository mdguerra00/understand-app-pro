

# Fix: quickEvidenceCheck Must Return Matched Evidence

## Problem

`quickEvidenceCheck` returns `{ feasible: boolean, missing: string[] }` but never tracks **what** matched. When the strong-constraint co-occurrence check passes (e.g., `checkCoOccurrence` returns `true`), the gate sets `feasible=true` with no proof. This makes debugging impossible and allows edge cases where `feasible=true` with zero actual evidence IDs.

## Current State (Verified)

- `hasStrongConstraints` definition (line 1905-1908): **Already correct** -- requires 2+ constraint types (material+additive, material+property, or additive+property). No fix needed.
- `quickEvidenceCheck` (line 2035): Returns `{ feasible, missing }` only -- **no matched evidence**.
- `checkCoOccurrence` (line 2268): Returns bare `boolean` -- **no IDs**.
- Gate callers (lines 2504, 2848): Use `feasible` but have no way to verify what matched.

## Changes

### 1. New return types

Add a `GateResult` type and update `checkCoOccurrence` to return matched IDs:

```typescript
type GateMatch = { type: "experiment" | "chunk"; id: string };
type GateResult = { feasible: boolean; missing: string[]; matched: GateMatch[] };
```

### 2. Update `checkCoOccurrence` to return experiment IDs

Change signature from `Promise<boolean>` to `Promise<GateMatch[]>`. Instead of returning `true` on first match, collect matched experiment IDs (up to 5) and return them. Return empty array if none found.

### 3. Rewrite `quickEvidenceCheck` strong-constraint path

- Collect `matched` array from co-occurrence calls
- Final gate: `feasible = missing.length === 0 && matched.length > 0`
- This ensures no `feasible=true` without at least one concrete evidence ID

### 4. Update weak-constraint path

For individual `existsInProject` checks, also collect matched IDs where possible (experiment IDs from title matches). Apply same rule: `feasible = missing.length === 0 && matched.length > 0`.

### 5. Update gate callers to log `matched`

At lines 2504 and 2848, destructure `matched` from the result and include it in diagnostics for full audit trail.

## File Changed

`supabase/functions/rag-answer/index.ts`:
- Lines 2035-2037: New return type
- Lines 2115-2204: Strong-constraint path collects matched IDs
- Lines 2207-2263: Weak-constraint path collects matched IDs  
- Lines 2268-2305: `checkCoOccurrence` returns `GateMatch[]` instead of `boolean`
- Lines 2500-2530: Gate caller logs matched evidence
- Lines 2846-2880: Comparative gate caller logs matched evidence

## Expected Outcome

- `feasible=true` is impossible without at least one concrete evidence ID in `matched[]`
- Diagnostics now include `evidence_matched: [{type: "experiment", id: "abc123"}]` for full auditability
- "prata na Vitality" with no co-occurring experiment: `feasible=false, matched=[], missing=["co-ocorrencia material+aditivo"]`

