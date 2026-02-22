

# Fix: Global Constraint Gate Not Blocking (Co-occurrence + Diagnostics Pass-through)

## Root Cause

Two bugs prevent the gate from working:

### Bug 1: `evidenceCheckPassed` not passed to 3-step diagnostics
Line ~2978-2986 builds `stdDiag` using `makeDiagnosticsDefaults` which sets `evidenceCheckPassed: null`. The actual variable `evidenceCheckPassed` (set at line 2362) is never included. This makes it impossible to see what the gate decided.

### Bug 2: `quickEvidenceCheck` checks constraints independently
The function checks each material and each additive separately. If "vitality" exists anywhere in the project AND "prata/silver/ag" exists anywhere else (even in unrelated documents), both pass and `feasible=true`. There is no requirement that material+additive co-occur in the same experiment or document.

For the query "prata na Vitality", the project likely has:
- Chunks mentioning "Vitality" (the resin) -- passes material check
- Chunks mentioning "silver" or "prata" or "ag" somewhere -- passes additive check
- But NO experiment combining both

## Fixes

### Fix 1: Pass `evidenceCheckPassed` to ALL diagnostics calls

In the 3-step `buildDiagnostics` call (~line 2978), add `evidenceCheckPassed` to the object. Same for any other path that omits it.

### Fix 2: Add co-occurrence check to `quickEvidenceCheck`

When BOTH `materials` and `additives` are non-empty, after the individual checks pass, add a co-occurrence verification:

```text
// After individual checks pass (missing.length === 0):
if (constraints.materials.length > 0 && constraints.additives.length > 0) {
  // Check if ANY experiment has BOTH material AND additive terms
  const materialTerms = constraints.materials; // e.g. ["vitality"]
  const additiveTerms = termMap expansions;     // e.g. ["silver","prata","ag","nanopart"]
  
  // Search experiments where title/conditions match material AND additive
  const coOccurrence = await checkCoOccurrence(supabase, projectIds, materialTerms, additiveTerms);
  
  if (!coOccurrence) {
    missing.push(`co-ocorrencia material+aditivo`);
    // feasible becomes false
  }
}
```

The co-occurrence check queries:
1. `experiments` where title matches a material term AND title/conditions match an additive term
2. `search_chunks` where chunk_text contains both a material term AND an additive term

If neither returns results, co-occurrence fails and the gate blocks.

### Fix 3: Ensure `evidenceCheckPassed` propagates to IDER and Comparative paths too

Review all `buildDiagnostics` calls to ensure `evidenceCheckPassed` is always included (not relying on `makeDiagnosticsDefaults` null).

## Expected behavior after fix

For "prata na Vitality":
- Individual checks: vitality found, silver/prata found
- Co-occurrence check: no experiment has both vitality AND silver/prata
- `feasible = false`, `missing = ["co-ocorrencia material+aditivo"]`
- Gate blocks: `pipeline_selected = "fail-closed-no-evidence"`
- `evidence_check_passed = false`
- `fail_closed_reason = "constraint_evidence_missing"`

## Files changed

1. `supabase/functions/rag-answer/index.ts`:
   - Add co-occurrence check inside `quickEvidenceCheck`
   - Pass `evidenceCheckPassed` variable to 3-step (and all other) `buildDiagnostics` calls

## Technical detail: co-occurrence query

```text
async function checkCoOccurrence(supabase, projectIds, materialTerms, additiveSearchTerms):
  // Strategy 1: experiments table
  for (mat of materialTerms):
    const { data } = await supabase.from('experiments')
      .select('id, title')
      .in('project_id', projectIds)
      .is('deleted_at', null)
      .ilike('title', `%${mat}%`)
      .limit(50);
    
    if (data?.length > 0):
      // Check conditions of these experiments for additive terms
      for (exp of data):
        const { data: conds } = await supabase.from('experiment_conditions')
          .select('value')
          .eq('experiment_id', exp.id);
        
        const allText = [exp.title, ...conds.map(c => c.value)].join(' ').toLowerCase();
        if (additiveSearchTerms.some(t => allText.includes(t))):
          return true;  // co-occurrence found

  // Strategy 2: search_chunks — both terms in same chunk
  for (mat of materialTerms):
    for (add of additiveSearchTerms):
      const { data } = await supabase.from('search_chunks')
        .select('id')
        .in('project_id', projectIds)
        .ilike('chunk_text', `%${mat}%`)
        .ilike('chunk_text', `%${add}%`)
        .limit(1);
      if (data?.length > 0): return true;

  return false;  // no co-occurrence
```

This approach limits additional queries and short-circuits on first match found.
