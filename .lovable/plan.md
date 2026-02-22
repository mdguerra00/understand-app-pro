

# Plano: Diagnosticos Detalhados + Regras Hard de Fail-Closed

## Resumo

Implementar o bloco `_diagnostics` unificado em todos os pipelines do `rag-answer`, com os 3 ajustes exigidos (verification detalhado, constraints aplicadas, fail-closed awareness) + request_id + 2 regras hard de fail-closed.

## Alteracoes

### 1. Migracao SQL: coluna `diagnostics` na tabela `rag_logs`

```text
ALTER TABLE rag_logs ADD COLUMN diagnostics jsonb DEFAULT NULL;
ALTER TABLE rag_logs ADD COLUMN request_id text DEFAULT NULL;
```

### 2. Bloco `_diagnostics` unificado (todos os pipelines)

Estrutura padrao retornada em TODOS os returns do `rag-answer/index.ts`:

```text
_diagnostics: {
  request_id: string (crypto.randomUUID()),

  // Intent detection
  pipeline_selected: "tabular-excel" | "tabular-excel-fail-closed" | "ider" | "ider-fail-closed" | "comparative" | "comparative-constrained" | "comparative-constrained-fail-closed" | "fail-closed-no-evidence" | "3-step",
  ider_intent: bool,
  tabular_intent: bool,
  comparative_intent: bool,

  // Constraints (ajuste #2)
  constraints_detected: { materials, additives, properties, hasStrongConstraints },
  constraints_keywords_hit: string[],   // termos exatos que matcharam
  constraints_scope: "project" | "global",
  material_filter_applied: bool,
  additive_filter_applied: bool,
  evidence_check_passed: bool | null,

  // Counts
  insight_seeds_count: number,
  experiments_count: number,
  variants_count: number,
  measurements_count: number,
  critical_docs: string[],
  chunks_used: number,

  // Audit
  audit_issues: { type, detail }[],

  // Verification detalhada (ajuste #1)
  verification_passed: bool,
  verification_numbers_extracted: number,
  verification_matched: number,
  verification_unmatched: number,
  verification_issue_types: string[],
  verification_unmatched_examples: { number: string, context: string }[],

  // Fail-closed awareness (ajuste #3)
  fail_closed_triggered: bool,
  fail_closed_reason: string | null,  // "no_evidence" | "numeric_grounding_failed" | "constraint_evidence_missing" | "cross_variant_mix" | "external_leak"
  fail_closed_stage: string | null,   // "routing" | "evidence_graph" | "synthesis" | "verification" | "audit"

  latency_ms: number,
}
```

### 3. Refatorar funcoes de verificacao para retornar dados detalhados

Alterar `verifyIDERNumbers()`, `verifyTabularResponse()` e `verifyResponse()` para retornar:

```text
{
  verified: bool,
  issues: string[],
  numbers_extracted: number,     // total de numeros nao-triviais na resposta
  matched: number,               // quantos bateram com evidence
  unmatched: number,             // quantos NAO bateram
  issue_types: string[],         // ex: ["missing_measurement", "not_in_evidence_graph"]
  unmatched_examples: { number: string, context: string }[]  // top 5 com trecho
}
```

O `context` de cada unmatched example sera extraido como ~30 chars ao redor do numero na resposta.

### 4. Duas regras hard de fail-closed (correcao de comportamento)

**Regra 1 -- IDER: verification_unmatched > 0 = fail-closed**

No bloco IDER (linhas ~2257-2269), apos verificacao:

```text
if (!iderVerification.verified) {
  // HARD FAIL: nao entregar resposta com numeros nao-groundados
  finalIDERResponse = failClosedMessage("numeric_grounding_failed", "verification", iderVerification);
  pipeline_selected = "ider-fail-closed-verification";
}
```

Em vez de apenas appendar warning, a resposta sera substituida por mensagem fail-closed explicando quais numeros nao bateram.

**Regra 2 -- Comparative com hasStrongConstraints + !feasible = fail-closed (ja implementado)**

Esta regra ja esta implementada no bloco comparative (linha 2335). Confirmar que nao ha fallback para ranking global.

### 5. Montar `_diagnostics` antes de cada return

Criar funcao helper `buildDiagnostics()` que recebe todos os parametros e monta o objeto. Chamar antes de cada `return new Response(...)`.

Para pipelines que nao tem certas variaveis (ex: tabular nao tem insight_seeds), preencher com defaults (0, [], null).

### 6. Persistir no rag_logs

Em cada insert de `rag_logs`, adicionar `diagnostics: diagnostics` e `request_id: requestId`.

### 7. Frontend: capturar e logar

No `src/hooks/useAssistantChat.ts`:
- Adicionar `diagnostics?: Record<string, any>` ao `ChatMessage`
- Ao receber resposta, capturar `data._diagnostics` e logar no console:
  ```text
  console.log('[RAG Diagnostics]', requestId, JSON.stringify(data._diagnostics, null, 2));
  ```

## Arquivos alterados

1. `supabase/functions/rag-answer/index.ts` -- refatorar verificadores, adicionar buildDiagnostics, regras hard, _diagnostics em todos os returns
2. `src/hooks/useAssistantChat.ts` -- capturar _diagnostics no ChatMessage
3. Migracao SQL -- colunas `diagnostics` e `request_id` em `rag_logs`

## O que NAO muda

- Logica de deteccao de intent (tabular/ider/comparative) permanece igual
- extractConstraints e quickEvidenceCheck permanecem iguais
- Standard pipeline permanece igual (exceto adicionar diagnostics)
- Nenhum componente UI alterado

## Secao tecnica: fluxo das variaveis

```text
startTime = Date.now()
requestId = crypto.randomUUID()

// Calcular TODOS os intents antes do roteamento
tabularIntent = detectTabularExcelIntent(query)
iderIntent = detectIDERIntent(query)
comparativeIntent = detectComparativeIntent(query)
constraints = extractConstraints(query)
constraintsKeywordsHit = [...constraints.materials, ...constraints.additives, ...constraints.properties]

// Roteamento usa esses valores pre-calculados
// Em cada return, chamar:
buildDiagnostics({
  requestId, pipeline, tabularIntent, iderIntent, comparativeIntent,
  constraints, constraintsKeywordsHit, scope, filterApplied,
  insightSeeds, experiments, variants, measurements, criticalDocs,
  auditIssues, verification, failClosed, latency
})
```

### Regra hard IDER -- comportamento detalhado

Quando `verifyIDERNumbers` retorna `unmatched > 0`:
- A resposta sintetizada NAO e entregue ao usuario
- Em seu lugar, retorna mensagem:

```text
VERIFICACAO FALHOU: {unmatched} numeros na resposta nao correspondem a medições do projeto.

Numeros sem evidencia: {top 5 examples com contexto}

A resposta foi bloqueada para evitar informacoes nao verificaveis. 
Para investigar, use a pergunta diretamente sobre o experimento/aba especifica.
```

- Pipeline registrado como `ider-fail-closed-verification`
- `fail_closed_triggered: true`, `fail_closed_reason: "numeric_grounding_failed"`, `fail_closed_stage: "verification"`

