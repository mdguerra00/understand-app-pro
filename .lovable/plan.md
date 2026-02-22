
# Plano: Gating com Constraints e Evidence Check — IMPLEMENTADO ✅

## Status: CONCLUÍDO

## O que foi implementado

### 1. `extractConstraints(query)` ✅
- Dicionário hardcoded PT/EN para materials (13 resinas), additives (5), properties (7)
- `hasStrongConstraints = true` quando >= 2 entidades detectadas

### 2. `quickEvidenceCheck(supabase, projectIds, constraints)` ✅
- Para cada constraint, busca em paralelo em: experiment_conditions, experiments (title/objective/hypothesis), search_chunks, measurements
- Todas queries com LIMIT 1
- Retorna `{ feasible, missing }` — `feasible=false` se qualquer constraint não tiver hit

### 3. `runComparativeConstrained()` ✅
- Busca current_best filtrado por experiment_conditions e experiment title matching material/aditivo
- Se após filtro não sobrar nada → fail-closed

### 4. Roteamento atualizado ✅
```
1. Tabular (inalterado)
2. IDER (inalterado)  
3. Comparative:
   a. extractConstraints(query)
   b. Se hasStrongConstraints:
      - quickEvidenceCheck → feasible?
      - Se NÃO: fail-closed-no-evidence
      - Se SIM: comparative-constrained (filtrado)
      - Se constrained retorna vazio: fail-closed também
   c. Se !hasStrongConstraints: comparative puro (inalterado)
4. Standard (inalterado)
```

### 5. Logging ✅
- `pipeline`: `fail-closed-no-evidence`, `comparative-constrained`, `comparative-constrained-fail-closed`
- `constraints_detected`: JSON com materials/additives/properties
- `evidence_check_passed`: boolean

### 6. Fail-closed message ✅
Formato: constraints detectadas + o que falta + instrução ao usuário
