# Smart Dent Manager 2.2 — Documentação Técnica

> Sistema de Gestão de P&D para materiais odontológicos com IA integrada.  
> Última atualização: 2026-02-10

---

## Índice

1. [Visão Geral](#1-visão-geral)
2. [Stack Tecnológica](#2-stack-tecnológica)
3. [Arquitetura do Sistema](#3-arquitetura-do-sistema)
4. [Estrutura do Projeto](#4-estrutura-do-projeto)
5. [Banco de Dados](#5-banco-de-dados)
6. [Edge Functions (Backend)](#6-edge-functions-backend)
7. [Pipeline de Indexação](#7-pipeline-de-indexação)
8. [Pipeline de Extração de Conhecimento](#8-pipeline-de-extração-de-conhecimento)
9. [Assistente IA (RAG)](#9-assistente-ia-rag)
10. [Sistema de Relatórios](#10-sistema-de-relatórios)
11. [Autenticação e Autorização](#11-autenticação-e-autorização)
12. [Design System](#12-design-system)
13. [Módulos Funcionais](#13-módulos-funcionais)
14. [Fluxos de Dados](#14-fluxos-de-dados)

---

## 1. Visão Geral

O **Smart Dent Manager** é um sistema web de gestão de Pesquisa & Desenvolvimento (P&D) especializado em materiais odontológicos. Ele substitui uma versão anterior baseada em Google Drive/JSON e foi reconstruído com tecnologias modernas.

### Funcionalidades Principais

| Módulo | Descrição |
|--------|-----------|
| **Dashboard** | Visão geral de projetos, tarefas, métricas e atividades recentes |
| **Projetos** | CRUD completo com status, categorias, membros e permissões por papel |
| **Tarefas** | Kanban com prioridades, responsáveis, datas e comentários |
| **Arquivos** | Upload, versionamento, detecção de duplicatas e processamento automático |
| **Base de Conhecimento** | Repositório unificado de insights, experimentos e medições estruturadas |
| **Assistente IA** | Chat RAG com busca híbrida, análise profunda de documentos e conversas persistentes |
| **Relatórios** | Geração automática por IA (progresso, final, executivo) com versionamento |
| **Busca Global** | Full-text search cross-entity com ranking de relevância |
| **Administração** | Gestão de usuários, papéis e criação de contas (admin only) |

---

## 2. Stack Tecnológica

### Frontend

| Tecnologia | Versão | Uso |
|------------|--------|-----|
| **React** | 18.3 | Framework UI |
| **TypeScript** | 5.x | Tipagem estática |
| **Vite** | 5.x | Build tool e dev server (HMR) |
| **TailwindCSS** | 3.x | Estilização utility-first |
| **shadcn/ui** | latest | Componentes UI (Radix UI primitives) |
| **React Router** | 6.30 | Roteamento SPA |
| **TanStack React Query** | 5.83 | Cache e estado servidor |
| **Lucide React** | 0.462 | Ícones |
| **React Markdown** | 10.1 | Renderização de Markdown |
| **Recharts** | 2.15 | Gráficos e visualizações |
| **React Hook Form** | 7.61 | Formulários |
| **Zod** | 3.25 | Validação de schemas |
| **date-fns** | 3.6 | Manipulação de datas |
| **Sonner** | 1.7 | Toasts / notificações |
| **Framer Motion** | — | Animações (via Tailwind Animate) |

### Backend (Lovable Cloud / Supabase)

| Tecnologia | Uso |
|------------|-----|
| **Supabase (PostgreSQL 15)** | Banco de dados relacional com RLS |
| **Supabase Auth** | Autenticação com email/senha |
| **Supabase Storage** | Armazenamento de arquivos (bucket: `project-files`) |
| **Supabase Edge Functions (Deno)** | Lógica de backend serverless |
| **pgvector** | Embeddings vetoriais para busca semântica |
| **Full-Text Search (tsvector)** | Busca textual em português |

### IA / Machine Learning

| Serviço | Modelo | Uso |
|---------|--------|-----|
| **Lovable AI Gateway** | `google/gemini-3-flash-preview` | RAG, extração de conhecimento, geração de relatórios, análise de documentos |
| **Lovable AI Gateway** | `text-embedding-3-small` | Geração de embeddings vetoriais (1536 dimensões) |

### Processamento de Documentos

| Biblioteca | Formato | Ambiente |
|------------|---------|----------|
| **SheetJS (xlsx)** | Excel (.xlsx, .xls) | Edge Function (Deno) |
| **pdfjs-serverless** | PDF | Edge Function (Deno) |
| **mammoth** | Word (.docx) | Edge Function (Deno) |

---

## 3. Arquitetura do Sistema

```
┌─────────────────────────────────────────────────┐
│                   FRONTEND                       │
│  React 18 + TypeScript + Vite + TailwindCSS     │
│                                                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ Pages    │ │Components│ │ Hooks            │ │
│  │ (Routes) │ │ (UI)     │ │ (useAuth,        │ │
│  │          │ │          │ │  useAssistantChat)│ │
│  └────┬─────┘ └────┬─────┘ └────────┬─────────┘ │
│       │            │                │            │
│       └────────────┴────────────────┘            │
│                    │                             │
│         Supabase JS Client SDK                   │
└────────────────────┬────────────────────────────┘
                     │ HTTPS / WebSocket
                     ▼
┌─────────────────────────────────────────────────┐
│              LOVABLE CLOUD (Supabase)            │
│                                                  │
│  ┌──────────────┐  ┌────────────────────────┐   │
│  │  PostgreSQL   │  │  Edge Functions (Deno) │   │
│  │  + pgvector   │  │                        │   │
│  │  + RLS        │  │  • rag-answer          │   │
│  │  + FTS        │  │  • extract-knowledge   │   │
│  │               │  │  • analyze-document    │   │
│  │  22 tabelas   │  │  • generate-report     │   │
│  │  12 funções   │  │  • index-content       │   │
│  │  4 triggers   │  │  • indexing-worker     │   │
│  └──────┬───────┘  │  • search-hybrid       │   │
│         │          │  • reindex-project      │   │
│         │          │  • save-analysis-insights│  │
│         │          │  • create-user          │   │
│         │          └───────────┬─────────────┘   │
│         │                     │                  │
│  ┌──────┴───────┐  ┌─────────┴──────────┐      │
│  │  Storage     │  │  Lovable AI Gateway │      │
│  │  (project-   │  │  (Gemini 3 Flash)   │      │
│  │   files)     │  │  + Embeddings API   │      │
│  └──────────────┘  └────────────────────┘       │
└─────────────────────────────────────────────────┘
```

---

## 4. Estrutura do Projeto

```
smart-dent-manager/
├── src/
│   ├── App.tsx                    # Roteamento principal
│   ├── main.tsx                   # Entry point
│   ├── index.css                  # Design tokens (HSL)
│   │
│   ├── pages/                     # 13 páginas/rotas
│   │   ├── Auth.tsx               # Login/Registro
│   │   ├── Dashboard.tsx          # Página inicial
│   │   ├── Projects.tsx           # Lista de projetos
│   │   ├── ProjectNew.tsx         # Criar projeto
│   │   ├── ProjectDetail.tsx      # Detalhe do projeto
│   │   ├── Tasks.tsx              # Gestão de tarefas
│   │   ├── Reports.tsx            # Relatórios
│   │   ├── Files.tsx              # Gestão de arquivos
│   │   ├── Knowledge.tsx          # Base de Conhecimento
│   │   ├── Assistant.tsx          # Assistente IA
│   │   ├── Settings.tsx           # Configurações do usuário
│   │   ├── Admin.tsx              # Painel administrativo
│   │   └── AcceptInvite.tsx       # Aceitar convite de projeto
│   │
│   ├── components/
│   │   ├── layout/                # AppLayout, AppSidebar, Breadcrumbs
│   │   ├── ui/                    # ~50 componentes shadcn/ui
│   │   ├── projects/              # ProjectAssistant, Settings, Indexing
│   │   ├── files/                 # Upload, Detail, Versions, Extraction
│   │   ├── knowledge/             # Cards, Filters, Modals (Document, Experiment, Knowledge)
│   │   ├── assistant/             # ChatMessage, ConversationList, SourcesPanel, SaveInsight
│   │   ├── reports/               # Generate, Editor, List, Outdated badges
│   │   ├── tasks/                 # Detail, Edit, Form, Comments
│   │   ├── search/                # GlobalSearch, SmartSearchDialog
│   │   └── admin/                 # CreateUserModal
│   │
│   ├── hooks/
│   │   ├── useAuth.tsx            # Context de autenticação
│   │   ├── useAssistantChat.ts    # Lógica do chat RAG
│   │   ├── useAdminRole.ts        # Verificação de papel admin
│   │   ├── useReportFreshness.ts  # Detecção de relatórios desatualizados
│   │   ├── useReprocessFile.ts    # Reprocessamento de arquivos
│   │   └── use-mobile.tsx         # Detecção de viewport mobile
│   │
│   └── integrations/supabase/
│       ├── client.ts              # Cliente Supabase (auto-gerado)
│       └── types.ts               # Tipos do banco (auto-gerado)
│
├── supabase/
│   ├── config.toml                # Configuração do projeto
│   ├── migrations/                # Migrações SQL (histórico completo)
│   └── functions/                 # 10 Edge Functions
│       ├── rag-answer/            # Assistente RAG
│       ├── extract-knowledge/     # Extração de conhecimento
│       ├── analyze-document/      # Análise profunda de documentos
│       ├── generate-report/       # Geração de relatórios por IA
│       ├── index-content/         # Indexação de conteúdo (chunking)
│       ├── indexing-worker/       # Worker assíncrono de indexação
│       ├── search-hybrid/         # Busca híbrida (semântica + FTS)
│       ├── reindex-project/       # Reindexação completa de projeto
│       ├── save-analysis-insights/# Salvamento de insights da análise
│       └── create-user/           # Criação de usuários (admin)
│
└── docs/
    └── TECHNICAL_DOCUMENTATION.md # Este arquivo
```

---

## 5. Banco de Dados

### 5.1 Diagrama de Entidades (22 tabelas)

#### Core

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `profiles` | Dados do usuário (email, nome, cargo, departamento) | ✅ |
| `user_roles` | Papéis globais (`admin`, `user`) | ✅ |
| `projects` | Projetos de P&D com status e datas | ✅ |
| `project_members` | Membros do projeto com papéis (`owner`, `manager`, `researcher`, `viewer`) | ✅ |
| `project_invites` | Convites pendentes com token hash e expiração | ✅ |

#### Gestão

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `tasks` | Tarefas com prioridade, status e atribuição | ✅ |
| `task_comments` | Comentários em tarefas | ✅ |
| `project_files` | Metadados dos arquivos enviados | ✅ |
| `project_file_versions` | Histórico de versões de arquivos | ✅ |
| `reports` | Relatórios (rascunho → submissão → revisão → aprovação) | ✅ |
| `report_versions` | Versionamento de relatórios | ✅ |
| `report_attachments` | Anexos de relatórios | ✅ |

#### Conhecimento Estruturado

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `knowledge_items` | Insights com 14 categorias, confiança e verificação de evidência | ✅ |
| `experiments` | Experimentos extraídos de documentos | ✅ |
| `measurements` | Medições quantitativas (métrica, valor, unidade, método, confiança) | ✅ |
| `experiment_conditions` | Condições experimentais (chave-valor) | ✅ |
| `experiment_citations` | Citações rastreáveis (página, planilha, célula, trecho) | ✅ |
| `metrics_catalog` | Catálogo de métricas canônicas com aliases | ✅ |
| `extraction_jobs` | Jobs de extração com status, fingerprint e qualidade | ✅ |

#### Busca e IA

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `search_chunks` | Fragmentos indexados com embedding vetorial + tsvector | ✅ |
| `indexing_jobs` | Fila de jobs de indexação assíncrona | ✅ |
| `rag_logs` | Logs de consultas RAG (query, chunks, latência, modelo) | ✅ |

#### Conversação

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `assistant_conversations` | Conversas do assistente por usuário/projeto | ✅ |
| `assistant_messages` | Mensagens com role, conteúdo, fontes e flag de erro | ✅ |

#### Auditoria

| Tabela | Descrição | RLS |
|--------|-----------|-----|
| `audit_log` | Log de auditoria automático (INSERT/UPDATE/DELETE) | ✅ |

### 5.2 Enums

| Enum | Valores |
|------|---------|
| `app_role` | `admin`, `user` |
| `project_role` | `owner`, `manager`, `researcher`, `viewer` |
| `project_status` | `planning`, `in_progress`, `review`, `completed`, `archived` |
| `task_status` | `todo`, `in_progress`, `review`, `done` |
| `task_priority` | `low`, `medium`, `high`, `urgent` |
| `report_status` | `draft`, `submitted`, `under_review`, `approved`, `archived` |
| `extraction_status` | `pending`, `processing`, `completed`, `failed` |
| `knowledge_category` | `compound`, `parameter`, `result`, `method`, `observation`, `finding`, `correlation`, `anomaly`, `benchmark`, `recommendation`, `cross_reference`, `pattern`, `contradiction`, `gap` |

### 5.3 Funções de Banco

| Função | Tipo | Descrição |
|--------|------|-----------|
| `is_project_member(user_id, project_id)` | SECURITY DEFINER | Verifica se usuário é membro do projeto |
| `has_project_role(user_id, project_id, min_role)` | SECURITY DEFINER | Verifica se usuário tem papel mínimo no projeto |
| `get_project_role(user_id, project_id)` | SECURITY DEFINER | Retorna o papel do usuário no projeto |
| `has_role(user_id, role)` | SECURITY DEFINER | Verifica papel global (admin/user) |
| `global_search(query, user_id)` | SECURITY DEFINER | Busca full-text cross-entity com ranking |
| `search_chunks_hybrid(text, embedding, project_ids, ...)` | SECURITY DEFINER | Busca híbrida semântica + FTS com pesos configuráveis |
| `handle_new_user()` | TRIGGER | Cria perfil e role 'user' ao registrar |
| `add_project_owner()` | TRIGGER | Adiciona criador como 'owner' do projeto |
| `queue_content_indexing()` | TRIGGER | Enfileira indexação ao criar/atualizar conteúdo |
| `update_updated_at_column()` | TRIGGER | Atualiza timestamp `updated_at` automaticamente |
| `audit_trigger_function()` | TRIGGER | Registra mudanças no `audit_log` |
| `increment_file_version()` | TRIGGER | Incrementa versão do arquivo ao adicionar nova versão |
| `increment_report_version()` | TRIGGER | Incrementa versão do relatório |

---

## 6. Edge Functions (Backend)

Todas as Edge Functions rodam em **Deno** (Supabase Edge Runtime) e são implantadas automaticamente.

### 6.1 `rag-answer` (425 linhas)

**Propósito:** Assistente RAG (Retrieval-Augmented Generation) principal.

**Fluxo:**
1. Autentica o usuário via JWT
2. Busca projetos acessíveis via `project_members`
3. **Busca dados estruturados** de `experiments` + `measurements` + `experiment_conditions` com filtragem por termos
4. **Busca chunks** via pipeline de 3 níveis:
   - Busca híbrida (`search_chunks_hybrid` — 65% semântica / 35% FTS)
   - Fallback FTS (`textSearch` com config `portuguese`)
   - Fallback ILIKE (termos individuais)
5. Monta prompt com dados estruturados + chunks + histórico de conversa (últimas 6 mensagens)
6. Gera resposta via **Gemini 3 Flash Preview** com formato obrigatório (Síntese, Evidências, Heurísticas, Lacunas, Fontes)
7. Loga no `rag_logs` com latência e chunks usados
8. Retorna response + sources (chunks + experiments mergeados)

**Modelo de IA:** `google/gemini-3-flash-preview` (temperatura 0.3, max 4000 tokens)

### 6.2 `extract-knowledge` (1359 linhas)

**Propósito:** Extração automática de conhecimento estruturado de documentos.

**Processamento por formato:**
- **Excel:** SheetJS com detecção heurística de cabeçalhos (palavras-chave como RF, MPa, densidade numérica)
- **PDF:** pdfjs-serverless para extração de texto
- **Word:** mammoth para conversão HTML → texto

**Saídas:**
- `knowledge_items`: Insights categorizados com evidência verificada
- `experiments`: Experimentos com título, objetivo e sumário
- `measurements`: Medições quantitativas com regras anti-alucinação
- `experiment_conditions`: Condições experimentais
- `experiment_citations`: Rastreabilidade até página/planilha/célula

**Regras anti-alucinação:**
1. Valor deve ser número válido
2. Unidade não pode ser vazia
3. `source_excerpt` deve conter o valor numérico
4. Evidência é verificada contra o conteúdo original

**Deduplicação:** Soft-delete automático de insights existentes do mesmo arquivo antes de inserir novos.

**Validação Inteligente (v2.3):** Insights são auto-validados APENAS quando:
- Excel parser determinístico + evidência verificada
- Confiança ≥ 0.8 + evidência verificada contra conteúdo original
- Caso contrário, ficam como `human_verified = false` aguardando revisão

### 6.3 `analyze-document` (286 linhas)

**Propósito:** Análise profunda de um documento individual com dados estruturados.

**Fluxo:**
1. Reconstrói conteúdo total do documento a partir de `search_chunks`
2. Enriquece com dados estruturados (`experiments`, `measurements`, `experiment_conditions`)
3. Fallback: usa `knowledge_items` existentes
4. Envia para Gemini com prompt especializado em P&D odontológico
5. Retorna análise detalhada com fontes

### 6.4 `rag-answer` — Pipeline 2 Passos (v2.3)

**Propósito:** Assistente RAG com profundidade analítica.

**Passo A — Evidence Plan** (oculto, modelo leve `gemini-2.5-flash-lite`):
- Identifica hipóteses e eixos de comparação
- Detecta trade-offs a investigar
- Mapeia lacunas de evidência
- Decide estratégia de síntese

**Passo B — Synthesis** (resposta final, `gemini-3-flash-preview`):
- Monta resposta com tabela de evidências programática
- Inclui comparações e correlações obrigatórias
- Usa resumos estatísticos agregados (`experiment_metric_summary`, `condition_metric_summary`)
- Usa insights relacionais como pivôs de navegação
- Identifica trade-offs e contradições explicitamente

**Fontes de dados paralelas:**
1. `search_chunks` (busca híbrida semântica + FTS)
2. `experiments` + `measurements` (dados estruturados)
3. `experiment_metric_summary` VIEW (agregações estatísticas)
4. `condition_metric_summary` VIEW (agregações por condição)
5. `knowledge_items` relacionais (correlações, contradições, padrões, lacunas)

### 6.5 `correlate-metrics` — Motor de Correlação (v2.3)

**Propósito:** Detecta automaticamente padrões, contradições e lacunas entre experimentos.

**Fluxo:**
1. Busca todos os experimentos e medições do projeto
2. Identifica métricas repetidas em 2+ experimentos
3. Mapeia cobertura de métricas por experimento
4. IA analisa e gera insights tipo `pattern`, `contradiction`, `gap`
5. Soft-delete de correlações anteriores antes de inserir novas

**Resultado:** Insights salvos em `knowledge_items` com `relationship_type = 'auto_correlation'`

### 6.6 `generate-report` (464 linhas)

**Propósito:** Geração automática de relatórios por IA.

**Tipos:** Progresso, Final, Executivo.

### 6.7 `index-content` (352 linhas)

**Propósito:** Indexação de conteúdo em chunks para busca (1000 chars, 100 overlap).

### 6.8 `indexing-worker` (125 linhas)

**Propósito:** Worker assíncrono que processa a fila de indexação (~2 min).

### 6.9 `search-hybrid` (189 linhas)

**Propósito:** Busca híbrida exposta como API (65% semântico / 35% FTS).

### 6.10 `reindex-project` (177 linhas)

**Propósito:** Reindexação completa de um projeto.

### 6.11 `save-analysis-insights` (370 linhas)

**Propósito:** Salva insights do assistente na Base de Conhecimento com validação inteligente.

### 6.12 `create-user` (117 linhas)

**Propósito:** Criação de usuários pelo administrador.

**Requisitos:** Papel `admin` no sistema.

---

## 7. Pipeline de Indexação

```
┌──────────────────┐
│ Criação/Edição   │   Trigger: queue_content_indexing()
│ de conteúdo      │──────────────────────────────────┐
│ (report, task,   │                                  │
│  file, insight)  │                                  ▼
└──────────────────┘                      ┌──────────────────┐
                                          │  indexing_jobs    │
                                          │  status: queued   │
                                          └────────┬─────────┘
                                                   │
                           Invocado a cada ~2 min  │
                                                   ▼
                                      ┌────────────────────┐
                                      │  indexing-worker    │
                                      │  (Edge Function)   │
                                      └────────┬───────────┘
                                               │
                                               ▼
                                      ┌────────────────────┐
                                      │  index-content     │
                                      │  (Edge Function)   │
                                      │                    │
                                      │  1. Busca conteúdo │
                                      │  2. Chunking 1000c │
                                      │  3. SHA-256 hash   │
                                      │  4. Embedding 1536d│
                                      │  5. Upsert chunks  │
                                      └────────┬───────────┘
                                               │
                                               ▼
                                      ┌────────────────────┐
                                      │  search_chunks     │
                                      │  • chunk_text      │
                                      │  • embedding (vec) │
                                      │  • tsv (FTS)       │
                                      │  • chunk_hash      │
                                      └────────────────────┘
```

---

## 8. Pipeline de Extração de Conhecimento

```
┌───────────────┐
│ Arquivo       │
│ (Excel/PDF/   │
│  Word)        │
└──────┬────────┘
       │
       ▼
┌──────────────────────────────────────────────────────┐
│  extract-knowledge (Edge Function)                    │
│                                                       │
│  ┌─────────────────┐  ┌─────────────┐  ┌──────────┐ │
│  │ SheetJS (Excel)  │  │ pdfjs (PDF) │  │ mammoth  │ │
│  │ Detecção         │  │ Extração    │  │ (Word)   │ │
│  │ heurística de    │  │ de texto    │  │          │ │
│  │ cabeçalhos       │  │ por página  │  │          │ │
│  └────────┬─────────┘  └──────┬──────┘  └────┬─────┘ │
│           └──────────────┬────┘──────────────┘       │
│                          ▼                            │
│  ┌───────────────────────────────────────────────┐   │
│  │  Gemini 3 Flash Preview                        │   │
│  │  • Tool Calling para extração estruturada     │   │
│  │  • Regras anti-alucinação rigorosas           │   │
│  │  • Verificação de evidência                   │   │
│  └───────────────────────┬───────────────────────┘   │
│                          │                            │
│  ┌───────────────┬───────┴─────┬──────────────────┐  │
│  ▼               ▼             ▼                  ▼  │
│ knowledge_    experiments   measurements   experiment_│
│ items         + conditions  (anti-hallu-   citations  │
│ (auto-valid)               cination)                 │
└──────────────────────────────────────────────────────┘
```

---

## 9. Assistente IA (RAG)

### 9.1 Arquitetura RAG Híbrida

```
  Pergunta do usuário
        │
        ├──────────────────────┐
        ▼                      ▼
  ┌──────────────┐    ┌───────────────────┐
  │ Embedding    │    │ Busca Estruturada │
  │ (1536d)      │    │ experiments +     │
  │              │    │ measurements +    │
  │ Busca        │    │ conditions        │
  │ Híbrida:     │    │ (keyword match)   │
  │ 65% semantic │    │                   │
  │ 35% FTS      │    └────────┬──────────┘
  └──────┬───────┘             │
         │                     │
         ▼                     ▼
   search_chunks        Dados Estruturados
   (até 15 chunks)      (até 10 experiments)
         │                     │
         └──────────┬──────────┘
                    ▼
          ┌──────────────────┐
          │ Gemini 3 Flash   │
          │ Preview          │
          │                  │
          │ System Prompt:   │
          │ • Especialista   │
          │   odontológico   │
          │ • Citações [1]   │
          │ • Tabela pré-    │
          │   construída     │
          │ • Anti-hallu     │
          │ • Histórico      │
          │   (6 msgs)       │
          └────────┬─────────┘
                   │
                   ▼
          Resposta formatada:
          1. Síntese Técnica
          2. Evidências (tabela)
          3. Heurísticas Derivadas
          4. Lacunas
          5. Fontes [1]...[E1]...
```

### 9.2 Tipos de Fontes

| Tipo | Prefixo | Cor/Ícone | Origem |
|------|---------|-----------|--------|
| Chunk de texto | `[1]`, `[2]` | Azul/Documento | search_chunks |
| Experimento | `[E1]`, `[E2]` | Verde/Flask | experiments |

### 9.3 Fallbacks de Busca

1. **Busca híbrida** (semântica + FTS via `search_chunks_hybrid`)
2. **FTS puro** (`textSearch` com config `portuguese`)
3. **ILIKE** (termos individuais como último recurso)

---

## 10. Sistema de Relatórios

### Workflow de Status

```
draft → submitted → under_review → approved → archived
```

### Geração por IA

A função `generate-report` coleta:
- Knowledge items (insights) do projeto
- Experiments com measurements
- Tasks (status e progresso)
- Arquivos do projeto

E gera relatórios em 3 formatos configuráveis com versionamento automático.

### Detecção de Desatualização

O hook `useReportFreshness` detecta relatórios que ficaram desatualizados quando:
- Novos insights foram extraídos após a última edição
- Novos arquivos foram adicionados
- Tasks mudaram de status

---

## 11. Autenticação e Autorização

### 11.1 Autenticação

- **Método:** Email + senha (Supabase Auth)
- **Confirmação de email:** Obrigatória
- **Sessão:** Persistida em localStorage com auto-refresh
- **Provider:** `AuthProvider` via React Context

### 11.2 Hierarquia de Papéis

#### Papéis Globais (`user_roles`)

| Papel | Capacidades |
|-------|------------|
| `user` | Acesso padrão a projetos onde é membro |
| `admin` | Tudo de `user` + painel administrativo + criação de usuários |

#### Papéis de Projeto (`project_members`)

| Papel | Nível | Capacidades |
|-------|-------|------------|
| `viewer` | 4 | Visualizar projeto, arquivos, tarefas |
| `researcher` | 3 | + Criar/editar tarefas, upload de arquivos |
| `manager` | 2 | + Gerenciar membros, configurações |
| `owner` | 1 | + Deletar projeto, transferir propriedade |

### 11.3 Row Level Security (RLS)

Todas as 22 tabelas possuem RLS habilitado. As políticas utilizam as funções auxiliares:

```sql
-- Exemplo: Política de leitura de projetos
CREATE POLICY "Members can view projects"
ON projects FOR SELECT
USING (is_project_member(auth.uid(), id));
```

---

## 12. Design System

### Paleta de Cores (HSL)

| Token | Valor (Light) | Uso |
|-------|---------------|-----|
| `--primary` | `173 77% 26%` | Teal principal (#0f766e) |
| `--secondary` | `175 30% 95%` | Backgrounds suaves |
| `--accent` | `175 40% 92%` | Hover states |
| `--muted` | `210 20% 96%` | Elementos neutros |
| `--destructive` | `0 84% 60%` | Ações de perigo |
| `--warning` | `38 92% 50%` | Alertas |
| `--success` | `142 76% 36%` | Confirmações |

### Componentes

- **Base:** shadcn/ui (50+ componentes) sobre Radix UI primitives
- **Layout:** Sidebar responsiva com `SidebarProvider`
- **Formulários:** React Hook Form + Zod validation
- **Feedback:** Sonner toasts + shadcn/ui toast
- **Ícones:** Lucide React

---

## 13. Módulos Funcionais

### 13.1 Gestão de Arquivos

- Upload com detecção de tipo MIME
- Versionamento automático (increment trigger)
- Detecção de duplicatas via `content_fingerprint` (SHA-256)
- Processamento automático: extração de conhecimento + indexação
- Reprocessamento manual com deduplicação de insights

### 13.2 Base de Conhecimento

- **14 categorias** de insights (compound, parameter, result, method, observation, finding, correlation, anomaly, benchmark, recommendation, cross_reference, pattern, contradiction, gap)
- **3 tipos de entidades:** Documentos, Insights de IA, Experimentos
- Filtros por categoria, confiança, validação, projeto e fonte
- Análise cross-document (padrões, contradições, lacunas)
- Auto-validação e deduplicação automática

### 13.3 Busca Global

- `global_search()` busca em 5 entidades: projetos, tarefas, arquivos, relatórios, knowledge_items
- Ranking por relevância com `ts_rank` (config `portuguese`)
- Atalho de teclado `Cmd+K` / `Ctrl+K`
- Navegação direta para resultado

---

## 14. Fluxos de Dados

### 14.1 Upload de Arquivo → Conhecimento

```
Upload → project_files → trigger queue_content_indexing()
  ├──→ indexing_jobs (queued)
  │     └──→ indexing-worker → index-content
  │           └──→ search_chunks (embedding + FTS)
  │
  └──→ (manual) extract-knowledge
        ├──→ knowledge_items (auto-validados)
        ├──→ experiments
        │     ├──→ measurements
        │     ├──→ experiment_conditions
        │     └──→ experiment_citations
        └──→ extraction_jobs (log)
```

### 14.2 Pergunta ao Assistente

```
Pergunta → useAssistantChat → rag-answer (Edge Function)
  ├──→ Busca experiments/measurements (estruturado)
  ├──→ Busca search_chunks (híbrida)
  ├──→ Monta contexto + histórico
  ├──→ Gemini 3 Flash Preview
  ├──→ rag_logs (telemetria)
  └──→ Resposta + sources → assistant_messages (persistido)
```

### 14.3 Geração de Relatório

```
Trigger → generate-report (Edge Function)
  ├──→ Coleta knowledge_items
  ├──→ Coleta experiments + measurements
  ├──→ Coleta tasks + files
  ├──→ Gemini 3 Flash Preview
  ├──→ reports (draft)
  └──→ report_versions (v1)
```

---

## Secrets Configurados

| Secret | Uso |
|--------|-----|
| `SUPABASE_URL` | URL do projeto |
| `SUPABASE_ANON_KEY` | Chave pública |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave admin (Edge Functions) |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública (frontend) |
| `LOVABLE_API_KEY` | Acesso ao AI Gateway (auto-provisionado) |
| `PERPLEXITY_API_KEY` | Conector Perplexity (managed) |

---

> **Nota:** Esta documentação reflete o estado atual do sistema em 10/02/2026. Para alterações no schema, consulte a pasta `supabase/migrations/`.
