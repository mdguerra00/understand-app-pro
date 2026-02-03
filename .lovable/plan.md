

# Plano: Integrar Perplexity AI no Sistema RAG

## Visao Geral

Substituir o Lovable AI Gateway pelo Perplexity API para gerar respostas no Assistente IA. O Perplexity oferece respostas de alta qualidade com capacidade de "grounded search" que pode complementar a busca nos documentos internos.

## Situacao Atual

O sistema possui 3 Edge Functions que usam IA:

| Funcao | Uso Atual | Mudanca |
|--------|-----------|---------|
| `rag-answer` | Lovable Gateway para chat | Migrar para Perplexity |
| `extract-knowledge` | Lovable Gateway para extração | Manter Lovable (funciona bem) |
| `index-content` | Embeddings (falhando) | Remover - usar busca por texto |

## Arquitetura Proposta

```text
Usuario pergunta
      |
      v
+------------------+     +------------------+
| Frontend         | --> | rag-answer       |
| (Assistant.tsx)  |     | Edge Function    |
+------------------+     +------------------+
                               |
       +-----------------------+-----------------------+
       |                                               |
       v                                               v
+------------------+                         +------------------+
| Busca Local      |                         | Perplexity API   |
| (ILIKE/FTS)      |                         | Geracao Resposta |
| search_chunks    |                         | Grounded in Docs |
+------------------+                         +------------------+
```

## Mudancas Necessarias

### 1. Edge Function `rag-answer/index.ts`

**Antes:**
- Tentava gerar embeddings via Lovable Gateway (falhava)
- Usava Lovable Gateway para chat completions

**Depois:**
- Remove tentativa de embeddings
- Usa busca ILIKE/FTS diretamente (ja funciona)
- Usa Perplexity API para gerar resposta baseada nos chunks encontrados

### 2. Edge Function `index-content/index.ts`

**Antes:**
- Tentava gerar embeddings via Lovable Gateway (falhava)
- Chunks eram salvos sem embeddings

**Depois:**
- Remove toda logica de embeddings
- Mantem apenas chunking e salvamento no banco
- Indexacao passa a funcionar sem erros

## Secao Tecnica

### Integracao Perplexity API

O Perplexity usa API compativel com OpenAI:

```typescript
// Novo codigo em rag-answer/index.ts
async function generateRAGResponse(
  query: string,
  chunks: ChunkSource[],
): Promise<{ response: string }> {
  const PERPLEXITY_API_KEY = Deno.env.get("PERPLEXITY_API_KEY");
  
  // Formatar chunks como contexto
  const context = chunks.map((chunk, i) => 
    `[${i+1}] ${chunk.chunk_text}`
  ).join("\n\n");

  const response = await fetch("https://api.perplexity.ai/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "sonar",
      messages: [
        { 
          role: "system", 
          content: `Voce e um assistente de P&D. Responda baseado APENAS nos trechos fornecidos. 
                    Use citacoes [1], [2] para cada afirmacao.`
        },
        { 
          role: "user", 
          content: `Contexto dos documentos:\n${context}\n\nPergunta: ${query}` 
        }
      ],
    }),
  });

  const data = await response.json();
  return { response: data.choices[0].message.content };
}
```

### Busca Simplificada (Remove Embeddings)

```typescript
// Remover generateQueryEmbedding() completamente
// Usar apenas busca ILIKE que ja funciona:

const searchTerms = query.split(/\s+/).filter(w => w.length > 2);
const orConditions = searchTerms.map(term => 
  `chunk_text.ilike.%${term}%`
).join(',');

const { data } = await supabase
  .from("search_chunks")
  .select(`id, chunk_text, metadata, projects(name)`)
  .in("project_id", targetProjectIds)
  .or(orConditions)
  .limit(12);
```

## Arquivos a Modificar

| Arquivo | Acao | Descricao |
|---------|------|-----------|
| `supabase/functions/rag-answer/index.ts` | Modificar | Substituir Lovable Gateway por Perplexity |
| `supabase/functions/index-content/index.ts` | Modificar | Remover logica de embeddings |
| `supabase/functions/search-hybrid/index.ts` | Modificar | Remover embeddings, usar apenas FTS/ILIKE |

## Beneficios

1. **Erro de indexacao resolvido** - Sem tentativa de embeddings que falham
2. **Assistente funcional** - Perplexity gera respostas de qualidade
3. **Busca funciona** - ILIKE/FTS ja encontra documentos
4. **Custo controlado** - Usa creditos Perplexity do usuario

## Ordem de Implementacao

1. Modificar `index-content` para remover embeddings
2. Modificar `search-hybrid` para usar apenas FTS/ILIKE
3. Modificar `rag-answer` para usar Perplexity
4. Redeployar todas as funcoes
5. Testar reindexacao (deve funcionar sem erros)
6. Testar Assistente IA (deve responder corretamente)

