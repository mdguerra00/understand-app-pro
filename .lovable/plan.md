
# Plano: Assistente IA com Chat Conversacional

## Visao Geral

Criar uma nova pagina dedicada para chat com a IA, onde o usuario pode fazer perguntas em linguagem natural e receber respostas baseadas em **todos os documentos e insights** de todos os projetos que ele tem acesso.

---

## Arquitetura

```text
+-------------------+     +------------------+     +----------------+
|   Nova Pagina     |     |  Edge Function   |     |   Supabase     |
|   /assistant      | --> |  rag-answer      | --> |  search_chunks |
|   (Chat UI)       |     |  (ja existe)     |     |  (cross-proj)  |
+-------------------+     +------------------+     +----------------+
```

A edge function `rag-answer` ja suporta busca em multiplos projetos - basta nao passar `project_ids` e ela busca em todos os projetos do usuario.

---

## Componentes a Criar

### 1. Nova Pagina: `src/pages/Assistant.tsx`

Interface de chat com:
- Area de mensagens com scroll
- Input de texto na parte inferior
- Botao de enviar
- Historico de conversa na sessao
- Suporte a markdown nas respostas
- Panel lateral com fontes citadas

Layout visual:
```text
+------------------------------------------+
|  Assistente IA                           |
+------------------------------------------+
|                                          |
|  [Usuario]: Qual a resistencia media...  |
|                                          |
|  [IA]: Conforme os documentos [1][2]...  |
|        - Valor X: 142 MPa                |
|        - Valor Y: 85 MPa                 |
|                                          |
|  [Usuario]: E a ductilidade?             |
|                                          |
|  [IA]: Os dados indicam [3]...           |
|                                          |
+------------------------------------------+
|  [ Digite sua pergunta...       ] [Send] |
+------------------------------------------+
```

### 2. Componente: `src/components/assistant/ChatMessage.tsx`

Renderiza uma mensagem individual:
- Diferencia usuario vs IA
- Renderiza markdown
- Mostra fontes inline

### 3. Componente: `src/components/assistant/SourcesPanel.tsx`

Panel lateral/colapsavel com todas as fontes citadas:
- Lista de documentos/insights referenciados
- Links para navegacao aos arquivos originais

---

## Alteracoes na Navegacao

### Arquivo: `src/components/layout/AppSidebar.tsx`

Adicionar novo item no menu principal:
```typescript
const mainNavItems = [
  { title: 'Dashboard', url: '/', icon: LayoutDashboard },
  { title: 'Assistente IA', url: '/assistant', icon: MessageCircle }, // NOVO
  { title: 'Projetos', url: '/projects', icon: FolderKanban },
  // ...
];
```

### Arquivo: `src/App.tsx`

Adicionar rota:
```typescript
<Route
  path="/assistant"
  element={
    <AppLayout>
      <Assistant />
    </AppLayout>
  }
/>
```

---

## Fluxo de Conversa

```text
Usuario digita pergunta
        |
        v
Adiciona mensagem do usuario ao historico local
        |
        v
Chama edge function rag-answer
(sem project_ids = busca em todos)
        |
        v
Recebe resposta com citacoes
        |
        v
Adiciona mensagem da IA ao historico
        |
        v
Renderiza fontes no painel lateral
```

---

## Secao Tecnica

### Interface de Mensagens

```typescript
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Array<{
    citation: string;
    type: string;
    id: string;
    title: string;
    project: string;
    excerpt: string;
  }>;
  timestamp: Date;
}
```

### Hook para Chat: `useAssistantChat`

```typescript
function useAssistantChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const sendMessage = async (content: string) => {
    // Adicionar mensagem do usuario
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, userMessage]);

    // Chamar RAG
    setIsLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    
    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/rag-answer`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ 
          query: content,
          // Nao passar project_ids = busca em todos
        }),
      }
    );

    const data = await response.json();
    
    // Adicionar resposta da IA
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: data.response,
      sources: data.sources,
      timestamp: new Date(),
    };
    setMessages(prev => [...prev, assistantMessage]);
    setIsLoading(false);
  };

  return { messages, isLoading, sendMessage };
}
```

### Renderizacao de Markdown

Usar biblioteca `react-markdown` que ja pode ser importada, ou renderizar markdown simples com regex para:
- Headers (## -> h2)
- Listas (- item)
- Negrito (**texto**)
- Citacoes [1], [2]

---

## Arquivos a Criar/Modificar

| Arquivo | Acao | Descricao |
|---------|------|-----------|
| `src/pages/Assistant.tsx` | Criar | Pagina principal do chat |
| `src/components/assistant/ChatMessage.tsx` | Criar | Componente de mensagem individual |
| `src/components/assistant/SourcesPanel.tsx` | Criar | Painel de fontes citadas |
| `src/hooks/useAssistantChat.ts` | Criar | Hook para gerenciar estado do chat |
| `src/components/layout/AppSidebar.tsx` | Modificar | Adicionar item de menu |
| `src/App.tsx` | Modificar | Adicionar rota /assistant |

---

## Features da Interface

1. **Chat em tempo real** - Feedback visual durante loading
2. **Historico na sessao** - Conversa persiste enquanto pagina aberta
3. **Fontes clicaveis** - Navegar para documento original
4. **Scroll automatico** - Rola para ultima mensagem
5. **Mensagens de erro** - Feedback claro se algo falhar
6. **Empty state** - Sugestoes de perguntas iniciais

---

## Empty State com Sugestoes

Quando nao ha mensagens, mostrar sugestoes de perguntas:
```text
+------------------------------------------+
|  Pergunte algo sobre seus projetos       |
|                                          |
|  Sugestoes:                              |
|  [ Qual a resistencia media dos...     ] |
|  [ Quais materiais foram testados...   ] |
|  [ Resuma os resultados de...          ] |
+------------------------------------------+
```

---

## Ordem de Implementacao

1. Criar hook `useAssistantChat`
2. Criar componente `ChatMessage`
3. Criar componente `SourcesPanel`
4. Criar pagina `Assistant.tsx`
5. Adicionar ao menu lateral
6. Adicionar rota no App.tsx
7. Testar conversa completa
