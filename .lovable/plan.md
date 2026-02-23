
# Auto-Alias + Provisional Auto-Pass: Implementacao Completa

## Visao Geral

Criar sistema de aliases dinamico com 3 tabelas novas (`entity_aliases`, `alias_cache`, `migration_logs`), integracao no `quickEvidenceCheck`, cache KV com cleanup via pg_cron, e Admin UI com tab "Aliases" incluindo filtros de status e soft-delete.

---

## 1. Migration SQL

### Tabelas

**entity_aliases**
- Campos: id, entity_type, canonical_name, alias, alias_norm, confidence, approved, source, needs_review, rejection_reason (text null), created_at, approved_by, approved_at, deleted_at, embedding vector(1536)
- Habilitar extensao `pg_trgm`
- Indices: (entity_type, approved) WHERE deleted_at IS NULL; GIN trigram em alias_norm; HNSW em embedding; UNIQUE (entity_type, alias_norm) WHERE deleted_at IS NULL
- RLS:
  - SELECT para authenticated
  - INSERT/UPDATE/DELETE para admin via has_role
  - Policy explicita para service_role: FOR ALL USING (true) WITH CHECK (true) TO service_role

**alias_cache**
- Campos: term_norm text, entity_type text, result jsonb, cached_at timestamptz default now(), hit_count int default 1
- PK composta (term_norm, entity_type)
- RLS: policy FOR ALL TO service_role only
- pg_cron job: DELETE WHERE cached_at < now() - interval '30 minutes' (a cada 10 minutos)

**migration_logs**
- Campos: id uuid PK, message text, created_at timestamptz default now()
- Sem RLS (service_role only)

### Seed

Popular entity_aliases com ~100+ aliases extraidos de:
- metrics_catalog (20 entradas com arrays de aliases)
- propTermMap hardcoded (flexural_strength, flexural_modulus, color, etc.)
- additiveTermMap hardcoded (silver_nanoparticles, silica_nanoparticle, bomar, etc.)
- materialDict hardcoded (vitality, filtek, charisma, etc.)

Todos com `approved=true, source='legacy_hardcoded', confidence=1.0`.

Usar `ON CONFLICT (entity_type, alias_norm) WHERE deleted_at IS NULL DO NOTHING` e registrar colisoes em migration_logs via bloco DO.

### pg_cron Job

```text
SELECT cron.schedule(
  'cleanup-alias-cache',
  '*/10 * * * *',
  $$DELETE FROM public.alias_cache WHERE cached_at < now() - interval '30 minutes'$$
);
```

---

## 2. Edge Function: normalizeTermWithUnits

No `rag-answer/index.ts`, helper:

```text
normalizeTermWithUnits(term) -> { original, normalized, ruleApplied }
```

Conversoes limitadas:
- Tamanho: X microns/um/micrometros -> X*1000 nm
- Viscosidade: X Pa.s -> X*1000 mPa.s
- Lowercase + unaccent base

NAO infere nano/micro como categoria.

---

## 3. Edge Function: suggestAlias

Funcao async no `rag-answer/index.ts`:

1. Normaliza termo
2. Checa alias_cache (TTL 30min) -- se hit, incrementa hit_count e retorna
3. Busca exata em entity_aliases (alias_norm = term_norm AND approved AND NOT deleted)
4. Se nao encontrar, gera embedding via text-embedding-3-small (LOVABLE_API_KEY)
5. Vector search top-3 em entity_aliases
6. Deteccao de conflito: delta top1-top2 < 0.05 -> ambiguous=true
7. Salva resultado no alias_cache (upsert)
8. Limite: max 5 termos desconhecidos por query

---

## 4. Gating Atualizado no quickEvidenceCheck

Para cada constraint nao encontrado pelo hardcoded existente:

1. Busca alias aprovado exato em entity_aliases
2. Se match aprovado -> match forte
3. Se nao -> suggestAlias:
   - Provisional auto-pass: score >= 0.80 AND !ambiguous AND textualEvidence=true
   - textualEvidence com peso explicito:
     - STRUCTURAL_WEIGHT = 1.0 (title, conditions, metrics)
     - CHUNK_WEIGHT = 0.5 (chunks, so se score > CHUNK_EVIDENCE_THRESHOLD = 0.75)
   - Constantes configuraveis no topo do arquivo
   - Conflito -> fail-closed reason='ambiguous_alias'
   - Score < 0.80 ou sem evidencia -> fail-closed reason='suggested_alias_pending'

4. Persistencia: score >= 0.70 e alias inexistente -> upsert entity_aliases com approved=false, source='user_query_suggest'

---

## 5. Diagnostics Expandido

Adicionar ao DiagnosticsInput e buildDiagnostics:

```text
suggested_aliases: [{
  term, term_norm, ruleApplied, entity_type,
  top_candidates: [{ canonical_name, score, approved }],
  ambiguous, provisional_pass,
  textual_evidence_sources: string[],
  textual_evidence_weight_calculated: number
}]
alias_lookup_latency_ms: number
```

Se alias_lookup_latency_ms > 500, adicionar 'alias_lookup_slow' ao verification.issue_types.

---

## 6. Admin UI: AliasApprovalTab

Novo componente `src/components/admin/AliasApprovalTab.tsx`:

- Tabela listando entity_aliases
- Input de busca por alias_norm ou canonical_name (ILIKE)
- Filtro de status: Todos / Pendentes / Aprovados / Rejeitados
- Coluna "Status" com badges:
  - Verde: Aprovado (approved=true, deleted_at IS NULL)
  - Amarelo: Pendente (approved=false, deleted_at IS NULL)
  - Vermelho: Rejeitado (deleted_at IS NOT NULL)
- Acoes:
  - Aprovar: SET approved=true, approved_by, approved_at
  - Rejeitar (soft-delete): SET deleted_at=now(), rejection_reason (input obrigatorio)
  - Restaurar (rejeitados): SET deleted_at=null, rejection_reason=null
  - Editar canonical_name inline
- Coluna "Motivo de Rejeicao" (exibe rejection_reason)

Integrar em `Admin.tsx` como tab "Aliases" com icone BookText.

---

## Arquivos Modificados

| Arquivo | Mudanca |
|---------|---------|
| Migration SQL (nova) | 3 tabelas + indices + RLS + pg_cron + seed |
| `supabase/functions/rag-answer/index.ts` | normalizeTermWithUnits, suggestAlias, cache KV, gating com entity_aliases, constantes configuraveis, diagnostics expandido |
| `src/pages/Admin.tsx` | Nova tab "Aliases" |
| `src/components/admin/AliasApprovalTab.tsx` | Novo componente |

## Travas de Seguranca

1. Auto-pass provisorio so com evidencia estrutural (peso 1.0 para title/conditions/metrics; 0.5 para chunks com threshold 0.75)
2. Unit normalization lossless (ruleApplied registrado; nao reclassifica nano/micro)
3. Conflito de canonicos bloqueia (delta < 0.05 -> ambiguous_alias)
4. Max 5 termos desconhecidos por query
5. Tudo de suggest entra como approved=false
6. Cache KV TTL 30min com pg_cron cleanup + hit_count incrementado
7. Service role bypass explicito em RLS

## Testes Planejados

1. Alias aprovado (ex: "rf" -> flexural_strength) -> gate passa
2. Novo termo sem evidencia textual -> fail-closed + suggested_aliases
3. Provisional auto-pass: score >= 0.80 + evidencia estrutural -> gate passa, provisional_pass=true
4. Conflito delta < 0.05 -> fail-closed ambiguous_alias + diagnostics.conflict=true
5. Query com 5 termos novos -> latencia total logada; warning se > 500ms
6. Query "silica 0.4nm na Vitality RF vs modulo" -> evidence_check_passed=true
