
# Plano: Conversa Progressiva e Salvar Insights das Conversas

## Resumo

Transformar o Assistente IA de um sistema de pergunta-resposta isolado para um sistema de conversas persistentes, onde o usuario pode:
1. Continuar conversas de sessoes anteriores
2. Salvar informacoes e insights valiosos das respostas do assistente diretamente na Base de Conhecimento

## Problema Atual

O hook `useAssistantChat` mantem as mensagens apenas em memoria (`useState`). Quando o usuario fecha a aba ou faz refresh, toda a conversa e perdida. Alem disso, nao existe mecanismo para guardar insights obtidos durante as conversas.

## Arquitetura Proposta

### Novas Tabelas no Banco de Dados

**1. Tabela `assistant_conversations`**
Armazena conversas do usuario com o assistente.

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | Identificador unico |
| user_id | uuid | Usuario dono da conversa |
| title | text | Titulo da conversa (gerado ou editavel) |
| project_id | uuid (nullable) | Projeto especifico (se for chat contextual) |
| created_at | timestamp | Data de criacao |
| updated_at | timestamp | Ultima atualizacao |

**2. Tabela `assistant_messages`**
Armazena todas as mensagens de cada conversa.

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| id | uuid | Identificador unico |
| conversation_id | uuid | FK para assistant_conversations |
| role | text | 'user' ou 'assistant' |
| content | text | Conteudo da mensagem |
| sources | jsonb (nullable) | Array de fontes citadas |
| is_error | boolean | Se e uma mensagem de erro |
| created_at | timestamp | Data/hora da mensagem |

### Mudancas no Frontend

**Arquivo: `src/hooks/useAssistantChat.ts`**
- Adicionar funcoes para carregar/salvar mensagens do banco
- Manter estado de `conversationId` atual
- Persistir mensagens automaticamente apos cada interacao
- Adicionar funcao `loadConversation(id)` e `createNewConversation()`

**Arquivo: `src/pages/Assistant.tsx`**
- Adicionar sidebar com lista de conversas anteriores
- Permitir criar "Nova conversa"
- Mostrar titulo da conversa atual no header
- Permitir renomear conversas

**Arquivo: `src/components/assistant/ChatMessage.tsx`**
- Adicionar botao "Salvar como Insight" nas mensagens do assistente
- Ao clicar, abrir modal para escolher projeto e categoria do insight

### Nova Funcionalidade: Salvar Insight da Conversa

**Novo arquivo: `src/components/assistant/SaveInsightModal.tsx`**
Modal que permite:
- Selecionar o projeto de destino
- Escolher a categoria do insight (finding, recommendation, observation, etc.)
- Editar titulo e conteudo antes de salvar
- Pre-preencher o campo de evidencia com a pergunta do usuario

Ao salvar:
- Criar registro em `knowledge_items` com:
  - `source_file_id`: null (nao veio de arquivo)
  - `extraction_job_id`: null (manual)
  - `evidence`: pergunta original do usuario
  - `extracted_by`: usuario atual

### Seguranca (RLS)

**assistant_conversations:**
- SELECT: usuarios podem ver suas proprias conversas
- INSERT: usuarios podem criar conversas
- UPDATE: usuarios podem atualizar suas conversas
- DELETE: usuarios podem deletar suas conversas

**assistant_messages:**
- SELECT: usuarios podem ver mensagens de suas conversas
- INSERT: usuarios podem adicionar mensagens em suas conversas
- UPDATE: nao permitido (mensagens sao imutaveis)
- DELETE: apenas ao deletar a conversa inteira

## Detalhes Tecnicos

| Arquivo | Tipo de Mudanca |
|---------|----------------|
| Migracao SQL | Criar tabelas e RLS |
| `src/hooks/useAssistantChat.ts` | Adicionar persistencia |
| `src/pages/Assistant.tsx` | Lista de conversas e header |
| `src/components/assistant/ChatMessage.tsx` | Botao salvar insight |
| `src/components/assistant/SaveInsightModal.tsx` | Novo componente |
| `src/components/assistant/ConversationList.tsx` | Novo componente (sidebar) |

## Fluxo do Usuario

### Conversa Progressiva
1. Usuario acessa /assistant
2. Sistema carrega ultima conversa ativa (ou cria nova se nao houver)
3. Usuario faz pergunta, sistema persiste mensagem
4. Usuario fecha aba e depois retorna
5. Sistema mostra conversa anterior, usuario pode continuar

### Salvar Insight
1. Usuario le uma resposta valiosa do assistente
2. Clica no botao "Salvar na Base" na mensagem
3. Modal abre pre-preenchido com titulo e conteudo
4. Usuario escolhe projeto e categoria
5. Insight e salvo em `knowledge_items` com `evidence` = pergunta original
6. Toast confirma: "Insight salvo com sucesso!"
7. Insight aparece na Base de Conhecimento do projeto

## Estimativa de Implementacao

1. Migracao SQL (tabelas + RLS): simples
2. Hook useAssistantChat atualizado: moderado
3. Lista de conversas (sidebar): moderado
4. Modal de salvar insight: moderado
5. Integracao e testes: moderado

