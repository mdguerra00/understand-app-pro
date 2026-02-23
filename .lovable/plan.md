

# Fix: quickEvidenceCheck False Negatives

## Problem
The gate blocks valid queries (e.g., "silica 0.4nm na Vitality, RF vs modulo") because:
- Property aliases are incomplete -- DB stores `resistncia_flexural`, `mdulo_flexural_mf` but the gate only searches `flexural_strength`
- "silica 0.4nm" is not in the additive dictionary
- Measurement queries search ALL experiments globally, not scoped to the current project
- No diagnostic breakdown of where matches were found

## Verified DB State

Actual metric names in the project:
```
resistncia_flexural, resistncia_flexural_rf, resistncia_flexural_com_carga
mdulo_flexural, mdulo_flexural_mf, mdulo_de_flexo
flexural_strength, flexural_strength_and, flexural_strength_control, flexural_strength_ct_0, flexural_strength_tp_45
flexural_modulus
e_reference_test_1__test_a, e_05_uv_absorber_test_4__test_a, e_15_hals_test_2__test_a (color/delta-E)
erro_relativo_estimado_nos_valores_de_cor
```

Silica experiment: "Vitality 09/06/25 + Base Webber + Silica 0.4nm (D+1)" with metrics `resistncia_flexural`, `mdulo_flexural`, `alongamento`.

## Changes (all in `supabase/functions/rag-answer/index.ts`)

### 1. Expand propTermMap with real DB aliases

Both strong-constraint (line ~2194) and weak-constraint (line ~2311) propTermMap:

```
flexural_strength: [
  'flexural_strength', 'flexural strength', 'resistencia flexural',
  'resistncia_flexural', 'resistncia_flexural_rf',
  'resistncia_flexural_com_carga', 'resistncia_flexural_resina_base',
  'flexural_strength_control', 'flexural_strength_ct_0',
  'flexural_strength_tp_45', 'flexural_strength_and', 'rf'
]
flexural_modulus: [
  'flexural_modulus', 'flexural modulus', 'modulo flexural',
  'mdulo_flexural', 'mdulo_flexural_mf', 'mdulo_de_flexo',
  'elastic_modulus', 'mf'
]
color: [
  'color', 'yellowing', 'delta_e', 'cor', 'amarel',
  'e_reference', 'e_05_uv', 'e_15_hals', 'e_30_hals',
  'erro_relativo_estimado_nos_valores_de_cor'
]
```

### 2. Add silica 0.4nm to additiveDict and additiveTermMap

In `additiveDict` (line ~1913):
```
silica_nanoparticle: /s[ií]lica\s*0[\.,]?4\s*n?m|sio2\s*0[\.,]?4|nano\s*s[ií]lica/
```

In both `additiveTermMap` locations (strong ~2187, weak ~2292):
```
silica_nanoparticle: ['silica 0.4', 'silica 0,4', 'sílica 0.4', 'sio2 0.4', 'nano silica', 'nano sílica', 'silica 0.4nm']
```

### 3. Scope measurement queries to project experiment IDs

Pre-fetch `expIds` once at the top of `quickEvidenceCheck` (before strong/weak branches), then pass them into every `.from('measurements')` call:

```typescript
// At top of quickEvidenceCheck, after line 2089
const { data: projExps } = await supabase
  .from('experiments').select('id')
  .in('project_id', projectIds).is('deleted_at', null);
const expIds = (projExps || []).map((e: any) => e.id);
```

Then add `.in('experiment_id', expIds)` to all measurement queries at lines ~2243 and ~2325. This also removes the duplicate `projExps` fetch inside `existsInProject`.

### 4. Extend GateMatch with source field and build constraint_hits

Update `GateMatch` type (line 2082):
```typescript
type GateMatch = { type: "experiment" | "chunk"; id: string; source?: string };
```

Tag each match in `existsInProject` with its source:
- Title matches: `source: 'title'`
- Condition matches: `source: 'conditions'`
- Chunk matches: `source: 'chunks'`
- Excerpt matches: `source: 'excerpt'`

Tag measurement matches with `source: 'metrics'`.

Build `constraint_hits` before returning from `quickEvidenceCheck`:
```typescript
const constraintHits = {
  hits_in_title: matched.filter(m => m.source === 'title').length,
  hits_in_conditions: matched.filter(m => m.source === 'conditions').length,
  hits_in_excerpt: matched.filter(m => m.source === 'excerpt').length,
  hits_in_metrics: matched.filter(m => m.source === 'metrics').length,
  hits_in_chunks: matched.filter(m => m.source === 'chunks').length,
};
```

### 5. Add constraint_hits to DiagnosticsInput and buildDiagnostics

Add to `DiagnosticsInput` (line ~1958):
```typescript
constraintHits: Record<string, number> | null;
quickMaterialFound: boolean | null;
quickPropertyFound: boolean | null;
quickAdditiveFound: boolean | null;
```

Add to `buildDiagnostics` output (line ~1986):
```typescript
constraint_hits: input.constraintHits,
quick_material_found: input.quickMaterialFound,
quick_property_found: input.quickPropertyFound,
quick_additive_found: input.quickAdditiveFound,
```

Update `makeDiagnosticsDefaults` and all gate callers to pass these new fields.

## Normalization

Add a simple `unaccent` helper used before all alias comparisons:
```typescript
function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
```

Apply it to both the query terms and the DB values when matching.

## File Changed
- `supabase/functions/rag-answer/index.ts`

## Expected Test Result
Query: "No projeto, o que aprendemos com a adicao de 5% de silica 0.4nm na Vitality? trade-offs (RF vs modulo)?"
- `evidence_check_passed: true`
- `quick_material_found: true` (vitality in title)
- `quick_additive_found: true` (silica 0.4nm in title)
- `quick_property_found: true` (resistncia_flexural + mdulo_flexural in metrics)
- `constraint_hits.hits_in_title > 0`
- `constraint_hits.hits_in_metrics > 0`
- Pipeline: `ider` (not fail-closed)

