
# Plano: 4 Correcoes de Gating no rag-answer

## Correcoes

### 1. Global Constraint Gate (antes do roteamento)

Inserir entre linha 2324 (apos `constraintsScope`) e linha 2326 (antes do routing):

- Se `preConstraints.hasStrongConstraints === true`, chamar `quickEvidenceCheck(supabase, targetProjectIds, preConstraints)`
- Se `feasible === false` -> return imediato `fail-closed-no-evidence` com `constraint_evidence_missing` / `routing`
- Isso impede que queries com constraints fortes caiam em IDER, Comparative ou 3-step sem evidencia

### 2. IDER: filtrar evidence graph por constraints

Na funcao `buildEvidenceGraph` (linhas 1367-1488):
- Adicionar parametro `constraints: QueryConstraints | null`
- Apos montar `expResults` (linha 1476), se `constraints?.hasStrongConstraints`, filtrar experimentos cujas conditions ou titulo contenham pelo menos um termo de material/aditivo
- Se 0 experimentos sobreviverem ao filtro, retornar graph vazio (que aciona fail-closed no caller)

Atualizar chamada em linha 2433 para passar `preConstraints`.

### 3. IDER: external leak programatico pre-sintese

Apos `buildEvidenceGraph` e antes de `synthesizeIDER` (entre linhas 2438 e 2468):
- Buscar `project_files.id` do projeto
- Comparar `doc_ids` do evidence graph contra project_files
- Se algum doc_id nao pertence ao projeto -> fail-closed com `external_leak` / `evidence_graph` / `ider-fail-closed`

### 4. Hard fail numerico no 3-step

No pipeline standard (linhas 2845-2850), mudar comportamento:
- Se `verification.unmatched > 0` -> substituir resposta por mensagem fail-closed
- Usar `fail_closed_reason: 'numeric_grounding_failed'`, `fail_closed_stage: 'verification'`, `pipeline: '3-step'` (manter enum)

## Detalhes tecnicos

### Correcao 1 - Insercao no main handler

```text
// Apos linha 2324 (constraintsScope), antes do routing
if (preConstraints.hasStrongConstraints) {
  const gateProjectIds = validPrimary.length > 0 ? validPrimary : allowedProjectIds;
  const { feasible, missing } = await quickEvidenceCheck(supabase, gateProjectIds, preConstraints);
  if (!feasible) {
    // RETURN IMEDIATO — nao cair em nenhum pipeline
    const latencyMs = Date.now() - startTime;
    const gateDiag = buildDiagnostics({
      ...defaults,
      pipeline: 'fail-closed-no-evidence',
      evidenceCheckPassed: false,
      failClosedTriggered: true,
      failClosedReason: 'constraint_evidence_missing',
      failClosedStage: 'routing',
    });
    // log + return com suggestions
  }
}
```

### Correcao 2 - buildEvidenceGraph com filtro

```text
async function buildEvidenceGraph(
  supabase, projectIds, query, insightSeeds, constraints  // <-- novo param
): Promise<EvidenceGraph> {
  // ... logica existente ...
  
  // APOS montar expResults (linha 1476):
  let filteredResults = expResults;
  if (constraints?.hasStrongConstraints) {
    const constraintTerms = [
      ...constraints.materials,
      ...constraints.additives.flatMap(a => termMap[a] || [a]),
    ];
    filteredResults = expResults.filter(exp => {
      const titleMatch = constraintTerms.some(t => exp.title.toLowerCase().includes(t));
      const condMatch = exp.variants.some(v =>
        Object.values(v.conditions).some(cv =>
          constraintTerms.some(t => cv.toLowerCase().includes(t))
        )
      );
      return titleMatch || condMatch;
    });
    diagnostics.push(`Constraint filter: ${expResults.length} -> ${filteredResults.length}`);
  }
  // Usar filteredResults no return
}
```

### Correcao 3 - External leak check

```text
// Entre evidence graph e synthesize (apos linha 2438)
const projectFileIds = new Set<string>();
const { data: pFiles } = await supabase
  .from('project_files').select('id').in('project_id', iderProjectIds);
for (const f of (pFiles || [])) projectFileIds.add(f.id);

const externalDocs = evidenceGraph.experiments
  .flatMap(e => e.doc_ids)
  .filter(d => d && !projectFileIds.has(d));

if (externalDocs.length > 0) {
  // fail-closed external_leak, pipeline = 'ider-fail-closed'
}
```

### Correcao 4 - 3-step hard fail

```text
// Linha 2847-2849: mudar de warning para hard fail
if (!verification.verified && verification.unmatched > 0) {
  finalResponse = fail-closed message com suggestions;
  // Atualizar stdDiag com failClosedTriggered=true
}
```

## Arquivos alterados

1. `supabase/functions/rag-answer/index.ts` — 4 blocos de correcao

## Enum de pipeline_selected (sem mudancas)

Os valores existentes sao mantidos: `ider`, `ider-fail-closed`, `tabular-excel`, `tabular-excel-fail-closed`, `comparative`, `comparative-constrained`, `comparative-constrained-fail-closed`, `fail-closed-no-evidence`, `3-step`.
