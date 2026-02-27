# Estudo aprofundado do app com foco em modelos de IA

## 1) Mapa atual de uso de IA no app

### 1.1 Gateway e arquitetura
- O app centraliza chamadas de IA no endpoint `https://ai.gateway.lovable.dev/v1/...` dentro das Edge Functions, reduzindo lock-in no frontend e facilitando governança de chave (`LOVABLE_API_KEY`).
- Há dois tipos de chamadas principais:
  - **Chat Completions** para extração, síntese, resposta RAG e geração de relatórios.
  - **Embeddings** para indexação e recuperação vetorial.

### 1.2 Modelos em produção hoje (ATUALIZADO com multi-model routing)

| Etapa | Função | Modelo (tier) |
|---|---|---|
| Resposta RAG (simples) | `rag-answer` | `google/gemini-2.5-flash-lite` (fast) |
| Resposta RAG (padrão) | `rag-answer` | `google/gemini-3-flash-preview` (standard) |
| Resposta RAG (complexo) | `rag-answer` | `google/gemini-2.5-pro` (advanced) |
| Planejamento leve no pipeline | `rag-answer` | `google/gemini-2.5-flash-lite` (fast) |
| IDER (raciocínio profundo) | `rag-answer` | `google/gemini-2.5-pro` (advanced) |
| Extração estruturada de planilhas/cabeçalhos | `extract-knowledge` | `google/gemini-2.5-flash` |
| Extração rica com tool-calling | `extract-knowledge` | `google/gemini-3-flash-preview` |
| Análise de documento (pequeno) | `analyze-document` | `google/gemini-3-flash-preview` (standard) |
| Análise de documento (grande) | `analyze-document` | `google/gemini-2.5-pro` (advanced) |
| Geração de relatório (progress/final) | `generate-report` | `google/gemini-2.5-pro` (advanced) |
| Geração de relatório (executivo) | `generate-report` | `google/gemini-3-flash-preview` (standard) |
| Correlação de métricas | `correlate-metrics` | `google/gemini-2.5-flash` |
| Persistência de insights da análise | `save-analysis-insights` | `google/gemini-2.5-flash` |
| Embeddings (RAG/indexação) | `rag-answer`, `index-content` | `text-embedding-3-small` |

### 1.3 Sinais de maturidade já existentes
- Pipeline de RAG em múltiplos modos (comparativo, tabular, “ider”) com registros de `model_used`, `latency_ms` e diagnósticos em `rag_logs`.
- Camada de fail-closed para evitar respostas sem evidência.
- Cache em memória para validações repetidas de alias.
- Uso de `tool_choice` para respostas estruturadas em extração/relatórios (melhora consistência).

---

## 2) Gargalos técnicos observados (impactam performance funcional e operacional)

### 2.1 Dependência de um único embedding model em todo o ciclo
- Toda recuperação vetorial está em `text-embedding-3-small` (alias + query + indexação).
- Isso simplifica, porém limita recall semântico em domínio técnico (materiais odontológicos, unidades, siglas, nomenclaturas).

**Impacto**:
- Menor precisão de recuperação em consultas complexas/ambíguas.
- Mais pressão sobre o modelo gerador para “compensar” retrieval imperfeito.

### 2.2 Modelo “flash” também em tarefas de alta criticidade sem fallback de qualidade
- Geração final de respostas e relatórios depende de `gemini-3-flash-preview`.
- Há fallback funcional (fail-closed), mas não há fallback “qualitativo” para um modelo mais forte quando score de confiança for baixo.

**Impacto**:
- Em perguntas analíticas difíceis, o app pode manter resposta conservadora (ou vazia) em vez de escalar para uma rota de maior capacidade.

### 2.3 Limites de contexto que podem cortar evidência útil
- Em `generate-report`, chunks de arquivo são truncados para evitar overflow de tokens.
- Em embeddings, inputs também são truncados (ex.: 8k chars), o que pode omitir partes essenciais.

**Impacto**:
- Perda de cobertura factual em relatórios longos e queries amplas.

### 2.4 Métricas de qualidade ainda implícitas
- O app loga latência e metadados de pipeline, mas não há métrica explícita de “qualidade de resposta”/“groundedness score” persistida em mesma granularidade para aprendizado de roteamento.

**Impacto**:
- Difícil comprovar ROI ao trocar modelo sem A/B formal contínuo.

---

## 3) Possibilidades reais de usar modelos mais avançados

> Premissa: disponibilidade via o mesmo AI Gateway (ou via adaptação mínima de provider routing no backend).

### 3.1 Estratégia recomendada: arquitetura de roteamento por complexidade
Em vez de substituir tudo por um modelo caro/lento, usar **roteamento multi-modelo**:

1. **Tier Fast/Low-cost** (perguntas simples, extração repetitiva, classificação)
   - Mantém flash-lite/flash.
2. **Tier Standard** (respostas RAG típicas)
   - Flash atual (ou equivalente mais novo estável).
3. **Tier Advanced** (comparações profundas, conflitos, explicações causais, respostas com baixa evidência)
   - Modelo de maior capacidade de raciocínio/síntese.

**Regra prática de escalonamento**:
- Se `chunks_count` baixo + intenção comparativa + contradições detectadas + confiança baixa => escalar para modelo avançado.

### 3.2 Onde modelos mais avançados tendem a gerar maior ganho

#### A) `rag-answer` (resposta final)
- Maior ganho esperado em:
  - síntese de trade-offs;
  - reconciliação de evidências contraditórias;
  - respostas comparativas multi-projeto.
- Hoje esse é o maior ponto de impacto no valor percebido pelo usuário.

#### B) `generate-report`
- Relatórios com múltiplas fontes, lacunas, limitações e próximos passos são candidatas naturais a modelo avançado em modo “quality-first” (sob demanda).

#### C) `extract-knowledge` (fase cross-doc)
- Cross-document linking e normalização semântica podem ganhar muito com modelo superior; isso melhora base de conhecimento e, em cascata, o RAG futuro.

### 3.3 Embeddings mais avançados (ou específicos de domínio)
- Trocar/avaliar embedding com maior capacidade semântica pode elevar recall e reduzir alucinação por falta de contexto.
- Opção híbrida: manter embedding barato para indexação ampla e usar embedding “premium” apenas para query-time rerank/retrieval crítico.

---

## 4) Como isso pode melhorar “performance” do app

### 4.1 Performance de produto (qualidade percebida)
- Respostas mais completas e confiáveis em cenários complexos.
- Menos respostas “fail-closed” por falta de confiança.
- Melhor aderência a contexto técnico e nomenclaturas de laboratório.

### 4.2 Performance operacional (latência/custo)
- Com roteamento inteligente, é possível **aumentar qualidade média** sem explodir custo:
  - 70–85% do tráfego continua em modelos rápidos.
  - 15–30% escalam para modelo avançado apenas quando necessário.
- Melhor retrieval (embedding/rerank) reduz tentativas extras e retrabalho de usuário.

### 4.3 Performance de engenharia (evolução contínua)
- Com telemetria A/B, decisões de modelo deixam de ser subjetivas.
- Facilidade para trocar provider/modelo sem alterar frontend (já centralizado nas edge functions).

---

## 5) Plano recomendado (90 dias)

### Fase 1 (0–2 semanas): observabilidade e baseline
1. Adicionar campos de avaliação automática por resposta no `rag_logs` (ex.: groundedness, citation_coverage, contradiction_flag).
2. Construir dashboard com:
   - latência p50/p95 por pipeline;
   - taxa de fail-closed;
   - satisfação do usuário (se existir feedback).
3. Congelar baseline atual por 1 semana.

### Fase 2 (2–6 semanas): piloto multi-modelo
1. Implementar roteamento por heurística no `rag-answer`:
   - simples => flash-lite/flash;
   - complexo/baixo score => modelo avançado.
2. Habilitar feature flag por projeto para piloto controlado.
3. Rodar A/B em 10–20% do tráfego.

### Fase 3 (6–10 semanas): otimização de retrieval
1. Testar embedding alternativo em shadow index.
2. Medir recall@k e impacto em groundedness final.
3. Se ganho > custo-alvo, migrar gradualmente.

### Fase 4 (10–12 semanas): consolidação
1. Revisar prompts/tool schemas onde modelo avançado não trouxe ganho.
2. Definir política de SLA por tipo de tarefa (tempo vs qualidade).
3. Padronizar playbook de rollback por modelo/provider.

---

## 6) Riscos e mitigação

- **Custo maior**: mitigar com roteamento por complexidade + budget guardrail por projeto.
- **Latência maior em modelo avançado**: usar timeout + fallback para resposta parcial estruturada.
- **Inconsistência entre modelos**: manter output via tools/schema rígido.
- **Dependência de um provedor**: preservar abstração no gateway/edge functions.

---

## 7) Recomendação executiva

A melhor evolução para este app **não é trocar tudo para um único modelo “mais forte”**. O caminho de maior ROI é:
1. **multi-model routing** com escalonamento por dificuldade;
2. **upgrade seletivo** em `rag-answer` e `generate-report`;
3. **melhoria de retrieval** (embedding/rerank) para aumentar qualidade na origem;
4. **A/B com telemetria** para comprovar ganho real em qualidade, latência e custo.

Isso tende a elevar substancialmente a qualidade das respostas e relatórios, mantendo custo/latência sob controle e com risco técnico baixo.
