
# Plano: Assistente IA Contextualizado por Projeto

## Visao Geral

Adicionar uma aba "Assistente IA" na pagina de detalhe do projeto (`/projects/:id`) que busca e responde apenas com dados do projeto especifico. Isso complementa o Assistente global existente em `/assistant`.

## Problema de Segunda Ordem: Rastreabilidade de Origem

Conforme mencionado, o usuario precisa saber de qual projeto veio cada informacao. A boa noticia: **a infraestrutura ja existe!**

| Elemento | Status | Onde |
|----------|--------|------|
| `project_id` nos chunks | Existe | `search_chunks.project_id` |
| `project_name` nas fontes | Existe | Retornado pelo `rag-answer` |
| Filtro por `project_ids` | Existe | Parametro aceito pela Edge Function |
| Exibicao do projeto na fonte | Existe | `SourcesPanel` agrupa por projeto |

## Arquitetura Proposta

```text
+---------------------+                    +---------------------+
|   /assistant        |                    |  /projects/:id      |
|   (Global)          |                    |  (Contextualizado)  |
+---------------------+                    +---------------------+
         |                                          |
         | project_ids = []                         | project_ids = [id]
         | (todos os projetos)                      | (apenas este projeto)
         |                                          |
         +------------------+   +-------------------+
                            |   |
                            v   v
                    +------------------+
                    |   rag-answer     |
                    |  Edge Function   |
                    +------------------+
                            |
                            v
                    +------------------+
                    |  search_chunks   |
                    |  (filtrado por   |
                    |   project_id)    |
                    +------------------+
```

## Mudancas Necessarias

### 1. Hook `useAssistantChat` - Aceitar `projectId` Opcional

**Antes:** O hook nao aceita parametros, busca em todos os projetos.

**Depois:** Aceita `projectId?: string` e passa como `project_ids: [projectId]` para a API.

### 2. Componente `ProjectAssistant` - Chat Embutido no Projeto

Criar componente que:
- Recebe `projectId` e `projectName` como props
- Usa o hook com filtro de projeto
- Exibe mensagens contextualizadas ("Pergunte sobre o projeto X")
- Layout compacto para caber na tab

### 3. Pagina `ProjectDetail` - Nova Aba "IA"

Adicionar quarta aba ao sistema de tabs existente:
- Tarefas | Arquivos | Relatorios | **Assistente IA**

### 4. Sugestoes Dinamicas por Projeto

Em vez de perguntas genericas, gerar sugestoes baseadas no contexto:
- "Quais insights foram extraidos neste projeto?"
- "Resuma os principais resultados deste projeto"
- "Quais arquivos foram analisados?"

## Diagrama de Componentes

```text
ProjectDetail.tsx
    |
    +-- Tabs
         |
         +-- TabsContent value="tasks" -> Tarefas
         +-- TabsContent value="files" -> Arquivos  
         +-- TabsContent value="reports" -> Relatorios
         +-- TabsContent value="assistant" -> ProjectAssistant (NOVO)
                                                    |
                                                    +-- useAssistantChat({ projectId })
                                                    +-- ChatMessage (reutilizado)
                                                    +-- SourcesPanel (reutilizado)
```

## Secao Tecnica

### Modificacao do Hook

```typescript
// useAssistantChat.ts
export function useAssistantChat(options?: { projectId?: string }) {
  const sendMessage = useCallback(async (content: string) => {
    // ... existing code ...
    
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-answer`,
      {
        method: 'POST',
        headers: { /* ... */ },
        body: JSON.stringify({ 
          query: content.trim(),
          // NOVO: Passar project_ids se especificado
          project_ids: options?.projectId ? [options.projectId] : undefined,
        }),
      }
    );
  }, [isLoading, options?.projectId]);
}
```

### Componente ProjectAssistant

```typescript
// src/components/projects/ProjectAssistant.tsx
interface ProjectAssistantProps {
  projectId: string;
  projectName: string;
}

export function ProjectAssistant({ projectId, projectName }: ProjectAssistantProps) {
  const { messages, isLoading, sendMessage, clearMessages } = useAssistantChat({ projectId });
  
  const suggestedQuestions = [
    `Quais insights foram extraidos do projeto ${projectName}?`,
    'Resuma os principais resultados encontrados',
    'Quais materiais foram testados neste projeto?',
    'Quais lacunas de conhecimento foram identificadas?',
  ];
  
  // ... render similar to Assistant.tsx but with project context
}
```

### Integracao com ProjectDetail

```typescript
// ProjectDetail.tsx - adicionar na area de tabs
<TabsList>
  <TabsTrigger value="tasks">Tarefas</TabsTrigger>
  <TabsTrigger value="files">Arquivos</TabsTrigger>
  <TabsTrigger value="reports">Relatorios</TabsTrigger>
  <TabsTrigger value="assistant">Assistente IA</TabsTrigger> {/* NOVO */}
</TabsList>

<TabsContent value="assistant">
  <ProjectAssistant projectId={id!} projectName={project.name} />
</TabsContent>
```

## Indicador Visual de Contexto

Para deixar claro ao usuario que esta em modo "projeto especifico":

```typescript
// No header do ProjectAssistant
<Badge variant="outline" className="bg-primary/10">
  <FolderOpen className="h-3 w-3 mr-1" />
  Contexto: {projectName}
</Badge>
```

E nas fontes, destacar que todas vem do mesmo projeto (ou alertar se vierem de outro, o que nao deveria acontecer):

```typescript
// SourcesPanel - quando projectId esta definido
{source.project !== projectName && (
  <Badge variant="destructive" className="text-xs">
    Fonte externa
  </Badge>
)}
```

## Arquivos a Modificar

| Arquivo | Acao | Descricao |
|---------|------|-----------|
| `src/hooks/useAssistantChat.ts` | Modificar | Adicionar parametro `projectId` |
| `src/components/projects/ProjectAssistant.tsx` | Criar | Componente de chat do projeto |
| `src/pages/ProjectDetail.tsx` | Modificar | Adicionar tab "Assistente IA" |
| `src/components/assistant/SourcesPanel.tsx` | Modificar | Indicador de contexto de projeto |

## Beneficios

1. **Foco contextualizado** - Respostas apenas sobre o projeto atual
2. **Menos ruido** - Nao mistura informacoes de outros projetos
3. **UX intuitiva** - Acesso direto na pagina do projeto
4. **Reutilizacao** - Mesmos componentes do Assistente global
5. **Rastreabilidade** - Fontes mostram claramente a origem

## Ordem de Implementacao

1. Modificar `useAssistantChat` para aceitar `projectId`
2. Criar `ProjectAssistant` componente
3. Adicionar tab em `ProjectDetail`
4. Atualizar `SourcesPanel` com indicador de contexto
5. Testar no projeto existente
