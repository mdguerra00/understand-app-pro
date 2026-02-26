# Auditoria de Funcionalidades Recentes

**Data da auditoria:** 2026-02-26  
**Auditor:** Lovable AI  

---

## 1. Sistema de Aliases (Auto-Alias + Provisional Auto-Pass)

### 1.1 Banco de Dados

| Item | Status | Evidência |
|------|--------|-----------|
| Tabela `entity_aliases` | ✅ Existe | 16 colunas: id, entity_type, canonical_name, alias, alias_norm, confidence, approved, source, rejection_reason, created_at, approved_by, approved_at, deleted_at, **rejected_at**, **rejected_by**, embedding(vector 1536) |
| Tabela `alias_cache` | ✅ Existe | PK tripla `(project_id, term_norm, entity_type)` + colunas: result(jsonb), cached_at, hit_count, last_hit_at |
| Tabela `migration_logs` | ✅ Existe | Colunas: id, message, severity, context(jsonb), created_at |
| Seed de aliases | ✅ 235 aliases | Todos `approved=true`. Log: "Seed completed with 9 collisions" em `migration_logs` |
| Índice GIN trigram | ✅ `idx_entity_aliases_alias_norm_trgm` | `USING gin (alias_norm gin_trgm_ops)` |
| Índice HNSW vetorial | ✅ `idx_entity_aliases_embedding` | `USING hnsw (embedding vector_cosine_ops)` |
| Unique constraint | ✅ `uq_entity_aliases_type_norm` | `(entity_type, alias_norm) WHERE deleted_at IS NULL` |
| Índice filtrado | ✅ `idx_entity_aliases_type_approved` | `(entity_type, approved) WHERE deleted_at IS NULL` |
| Cache índice temporal | ✅ `idx_alias_cache_project_cached` | `(project_id, cached_at DESC)` |
| pg_cron cleanup (job #2) | ✅ Ativo | `*/10 * * * *` — deleta `alias_cache` > 30min, loga em `migration_logs` |

### 1.2 RLS

| Policy | Tabela | Comando |
|--------|--------|---------|
| `Authenticated users can view aliases` | entity_aliases | SELECT (true para autenticados) |
| `Admins can manage aliases` | entity_aliases | ALL (has_role admin) |
| `Service role full access to aliases` | entity_aliases | ALL (service_role bypass) |
| `Service role full access to alias_cache` | alias_cache | ALL |
| `Service role full access to migration_logs` | migration_logs | ALL |

**Nota:** `alias_cache` e `migration_logs` são acessíveis apenas via `service_role`. ✅

### 1.3 Edge Function (`rag-answer/index.ts`)

| Funcionalidade | Status | Localização |
|----------------|--------|-------------|
| Constantes configuráveis | ✅ | Linhas 46-52: `STRUCTURAL_WEIGHT`, `CHUNK_WEIGHT`, `CHUNK_EVIDENCE_THRESHOLD`, `ALIAS_AUTOPASS_THRESHOLD=0.80`, `ALIAS_SUGGEST_THRESHOLD=0.70`, `ALIAS_AMBIGUITY_DELTA=0.05`, `MAX_UNKNOWN_TERMS_PER_QUERY=5` |
| `normalizeTermWithUnits()` | ✅ | Linhas 63-93: range detection skip, micron→nm, Pa.s→mPa.s |
| `suggestAlias()` | ✅ | Linhas 111-260+: cache check → exact match → trigram (score>0.4) → vector embedding fallback |
| Cache KV (alias_cache) | ✅ | TTL 30min, hit_count increment, PK tripla por projeto |
| Ambiguity detection | ✅ | Delta top1-top2 < 0.05 → `ambiguous=true` |
| In-memory `existsInProject` cache | ✅ | Linhas 13-39: TTL 5min, max 500 entries, warm invocation persistence |
| Diagnostics: `alias_lookup_latency_ms` | ✅ | Incluído em `buildDiagnostics` (linha 2425) |
| Diagnostics: `suggested_aliases` | ✅ | Array com detalhes por termo no bloco de diagnósticos |

### 1.4 Testes Unitários

| Arquivo | Testes | Status |
|---------|--------|--------|
| `alias-gating.test.ts` | 6 testes | ✅ Presente |

Testes cobrem:
1. Range detection skip (3 variantes)
2. Micron → nm conversion
3. Pa.s → mPa.s conversion
4. Trigram similarity para termos dentais
5. Ambiguity detection (delta < 0.05)
6. Structural evidence requirement

### 1.5 Admin UI (`AliasApprovalTab.tsx`)

| Funcionalidade | Status | Evidência |
|----------------|--------|-----------|
| Tabela com todos aliases | ✅ | 9 colunas: Alias, Nome Canônico, Tipo, Confiança, Fonte, Status, Motivo Rejeição, Criado em, Ações |
| Busca por alias/canônico | ✅ | Input com ILIKE no `alias_norm` e `canonical_name` |
| Filtro por status | ✅ | All/Pendentes/Aprovados/Rejeitados |
| Ordenação | ✅ | Data/Confiança/Fonte |
| Badges coloridos | ✅ | Verde=Aprovado, Amarelo=Pendente, Vermelho=Rejeitado, Outline=Oculto |
| Ação Aprovar | ✅ | Seta `approved=true`, `approved_at`, `approved_by`, limpa `rejected_*` |
| Ação Rejeitar | ✅ | Dialog com `rejection_reason` **obrigatório** (linha 132: `if (!rejectionReason.trim())`) |
| Ação Restaurar | ✅ | Limpa `rejected_at`, `rejected_by`, `rejection_reason` |
| Editar canônico | ✅ | Dialog com input para `canonical_name` |
| Tab "Aliases" no Admin | ✅ | `Admin.tsx` linha 334: ícone `BookText` |

---

## 2. Knowledge Facts (Conhecimento Manual Autoritativo)

### 2.1 Banco de Dados

| Item | Status | Evidência |
|------|--------|-----------|
| Tabela `knowledge_facts` | ✅ | 17 colunas: id, project_id(nullable→global), category, key, title, value(jsonb), description, tags, authoritative, priority(0-100), status, created_by, updated_by, created_at, updated_at, version, embedding(vector 1536) |
| Tabela `knowledge_facts_versions` | ✅ | 7 colunas: id, fact_id, version, old_value, old_title, change_reason, changed_by, changed_at |
| Tabela `knowledge_facts_logs` | ✅ | 6 colunas: id, fact_id, action, user_id, details, timestamp |
| UNIQUE index | ✅ | `(COALESCE(project_id, '00000000...'), category, key)` |
| HNSW embedding | ✅ | `idx_knowledge_facts_embedding` |
| GIN tags | ✅ | `idx_knowledge_facts_tags` |
| GIN value | ✅ | `idx_knowledge_facts_value` |
| Índice project_id+status | ✅ | `idx_knowledge_facts_project_status` |
| Índice category | ✅ | `idx_knowledge_facts_category` |
| Trigger versionamento | ✅ | `knowledge_fact_version_trigger()` — auto-increment version, insere old state |
| Trigger validação | ✅ | `validate_knowledge_fact_value()` — schema por category (price: valor+unidade), limits (5000 bytes, 2000 chars desc) |
| Dados existentes | ✅ | 1 fact (category=rule, status=active) |

### 2.2 RLS

| Policy | Comando | Condição |
|--------|---------|----------|
| `Users can view global facts` | SELECT | `project_id IS NULL AND auth.uid() IS NOT NULL` |
| `Members can view project facts` | SELECT | `project_id IS NOT NULL AND is_project_member()` |
| `Admins can view all facts` | SELECT | `has_role(admin)` |
| `Admins can manage all facts` | ALL | `has_role(admin)` |
| `Managers can manage project facts` | INSERT | `project_id IS NOT NULL AND has_project_role(manager)` |
| `Managers can update project facts` | UPDATE | idem |
| `Managers can delete project facts` | DELETE | idem |
| Versions/Logs SELECT | SELECT | `auth.uid() IS NOT NULL` |
| Versions/Logs INSERT | INSERT | `auth.uid() IS NOT NULL` |

### 2.3 RAG Integration (`rag-answer/index.ts`)

| Funcionalidade | Status | Evidência |
|----------------|--------|-----------|
| `fetchKnowledgeFacts()` | ✅ | Linha 1105: busca project-scoped + global, project overrides global by category/key |
| Consulta direta (sem cache) | ✅ | Busca direto no DB a cada query |
| Scoring híbrido | ✅ | `embedding similarity + priority * 0.05 + authoritative * 0.5` |
| Wiring no Standard pipeline | ✅ | Linha 3840: em `Promise.all` com métricas e pivots |
| Wiring no IDER pipeline | ✅ | Linha 3402: em `Promise.all` com critical docs |
| Wiring no Comparative pipeline | ✅ | Linha 3886: em `Promise.all` |
| Contexto como "Fonte da Verdade" | ✅ | Injeção de bloco com instrução para LLM citar "Conhecimento Manual [ID]" |
| IDER: doc virtual `manual_knowledge` | ✅ | Injetado no `deepReadPack` |
| Diagnostics: `manual_knowledge_hits` | ✅ | Linha 2427 |
| Diagnostics: `applied_as_source_of_truth` | ✅ | Linha 2428 |
| Diagnostics: `override_conflicts` | ✅ | Linha 2429 |

### 2.4 Indexação (`index-content/index.ts`)

| Funcionalidade | Status | Evidência |
|----------------|--------|-----------|
| source_type `manual_knowledge` | ✅ | Linha 232: busca fact, gera embedding, upsert search_chunks |
| Remoção para facts arquivados | ✅ | Linha 241-244: delete chunks + retorna `archived_fact_removed` |

### 2.5 UI

| Componente | Status | Funcionalidade |
|------------|--------|----------------|
| `FactsList.tsx` | ✅ | Lista com filtros: Global/Projeto, Status, Category, Busca |
| `FactCard.tsx` | ✅ | Card com badges (authoritative, priority, status) |
| `FactFormModal.tsx` | ✅ | CRUD: category, key, title, value(JSON), description, authoritative toggle, priority. **Edição exige change_reason** |
| `FactDetailModal.tsx` | ✅ | Detalhe com histórico de versões, ações Arquivar/Reativar |
| Integração `Knowledge.tsx` | ✅ | Linha 353: `<FactsList>` renderizado no filtro "all" ou "facts" |

---

## 3. Infraestrutura Comum

### 3.1 pg_cron Jobs

| Job | Schedule | Função |
|-----|----------|--------|
| #1 Indexing Worker | `*/2 * * * *` | Processa `indexing_jobs` pendentes em lotes de 5 |
| #2 Alias Cache Cleanup | `*/10 * * * *` | Deleta `alias_cache` > 30min, loga em `migration_logs` |

### 3.2 Edge Functions

| Função | Linhas | Propósito |
|--------|--------|-----------|
| `rag-answer` | 4017 | Pipeline RAG completo (Standard 3-step + IDER + Comparative + Tabular) |
| `index-content` | 397 | Indexação de chunks com embeddings |
| `indexing-worker` | — | Worker assíncrono (pg_cron trigger) |

### 3.3 Testes

| Arquivo | Testes |
|---------|--------|
| `alias-gating.test.ts` | 6 testes (normalização, trigram, ambiguidade, evidência estrutural) |
| `ider-mode.test.ts` | Testes do pipeline IDER |
| `tabular-mode.test.ts` | Testes do modo tabular |

---

## 4. Problemas Identificados / Observações

### 4.1 Nenhum Problema Crítico Encontrado

Todos os componentes auditados estão funcionais e consistentes entre DB schema, edge functions e UI.

### 4.2 Observações Menores

| # | Observação | Severidade | Recomendação |
|---|-----------|------------|--------------|
| 1 | `AliasApprovalTab.tsx` (348 linhas) usa `(supabase as any)` | Baixa | Esperado — tabela nova ainda sem types regenerados no momento da criação. Types já incluem `entity_aliases` agora. |
| 2 | `rag-answer/index.ts` tem 4017 linhas | Informativa | Arquivo grande mas modular internamente. Considerar split futuro em módulos separados. |
| 3 | `knowledge_facts_versions` tem 0 registros | Informativa | Normal — apenas 1 fact existe e nunca foi editado. Trigger de versionamento está ativo. |
| 4 | Latência alias lookup reportada ~752ms em teste real | Monitorar | Warning `alias_lookup_slow` dispara corretamente quando > 500ms. Cache KV reduz para <1ms em hits subsequentes. |

---

## 5. Resumo Executivo

| Módulo | Completude | Integração RAG | UI | Testes | Segurança (RLS) |
|--------|-----------|----------------|-----|--------|-----------------|
| Auto-Alias System | ✅ 100% | ✅ Gating + Cache | ✅ Admin Tab | ✅ 6 testes | ✅ Completa |
| Knowledge Facts | ✅ 100% | ✅ 3 pipelines | ✅ CRUD completo | ⚠️ Sem testes unitários dedicados | ✅ Completa |
| Infraestrutura (pg_cron, indexing) | ✅ 100% | ✅ | N/A | N/A | ✅ service_role only |

**Conclusão:** Ambos os módulos estão **totalmente implementados e integrados** no pipeline RAG, com segurança RLS adequada, UI funcional e monitoramento via diagnostics.
