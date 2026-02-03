
# Plano: Corrigir Sistema RAG - Busca AI Retornando Sem Resultados

## Diagnostico do Problema

A investigacao revelou que:

1. **Os chunks existem**: 32 chunks indexados no projeto, incluindo dados sobre BISEMA, TEG, UDMA
2. **A edge function funciona**: Teste direto retornou 12 chunks e resposta completa
3. **A busca do usuario falhou**: Nenhum log "ILIKE found" ou "FTS found" para a query do usuario

### Causa Raiz Identificada

O problema esta na limpeza dos termos de busca e no tratamento de erros:

| Problema | Impacto |
|----------|---------|
| Pontuacao nos termos (`TEG.`, `Paulo,`, `promissora.`) | ILIKE pode falhar silenciosamente |
| Sem log de erro na busca ILIKE | Impossivel diagnosticar falhas |
| Query muito longa (35 termos) | Pode exceder limites ou timeout |
| Termos duplicados (`com`, `quando`, `que`) | Desperdicio de processamento |

### Evidencia do Problema

Query do usuario:
```
Search terms: ["aba", "Paulo,", "Bisgma", "mostrou", "bons", "resultados", "quando", "diluido", "TEG.", ...]
```

Note: `TEG.` com ponto, `Paulo,` com virgula - esses caracteres especiais nao deveriam estar nos termos de busca.

## Arquitetura da Solucao

```text
Query do Usuario
      |
      v
+---------------------+
| Normalizacao        |
| - Remove pontuacao  |
| - Lowercase         |
| - Remove duplicatas |
| - Limita termos (10)|
+---------------------+
      |
      v
+---------------------+
| Busca Hibrida       |
| 1. Try FTS primeiro |
| 2. Fallback ILIKE   |
| 3. Log de erros     |
+---------------------+
      |
      v
Resposta com chunks
```

## Mudancas Propostas

### 1. Normalizar Termos de Busca (Correcao Principal)

**Antes:**
```typescript
const searchTerms = query.split(/\s+/).filter((w: string) => w.length > 2);
```

**Depois:**
```typescript
const searchTerms = query
  .toLowerCase()
  .replace(/[^\w\sáàâãéèêíìîóòôõúùûç]/gi, '') // Remove pontuacao
  .split(/\s+/)
  .filter((w: string) => w.length > 2)
  .filter((w, i, arr) => arr.indexOf(w) === i) // Remove duplicatas
  .slice(0, 10); // Limita a 10 termos
```

### 2. Adicionar Logs de Erro para Debug

```typescript
if (ilikeError) {
  console.error("ILIKE search error:", ilikeError.message);
  console.error("OR conditions:", orConditions);
}
```

### 3. Melhorar Query FTS

Usar `plainto_tsquery` em vez de `websearch` para queries muito longas que podem falhar:

```typescript
// Tentar FTS com query simplificada
const ftsQuery = searchTerms.slice(0, 5).join(' | ');
```

## Arquivo a Modificar

| Arquivo | Acao | Mudancas |
|---------|------|----------|
| `supabase/functions/rag-answer/index.ts` | Modificar | Normalizar termos, adicionar logs de erro, melhorar fallback |

## Codigo Detalhado da Correcao

### Secao de Normalizacao (linhas ~200-205)

```typescript
// Normalize and extract search terms
const normalizedQuery = query
  .toLowerCase()
  .replace(/[^\w\sáàâãéèêíìîóòôõúùûç]/gi, ' ') // Replace punctuation with space
  .replace(/\s+/g, ' ')
  .trim();

const searchTerms = normalizedQuery
  .split(' ')
  .filter((w: string) => w.length > 2) // Min 3 chars
  .filter((w, i, arr) => arr.indexOf(w) === i) // Unique only
  .slice(0, 10); // Max 10 terms for performance

console.log("Normalized search terms:", searchTerms);
```

### Secao de Busca ILIKE (linhas ~233-257)

```typescript
// Fallback to ILIKE if FTS returned no results
if (searchResults.length === 0 && searchTerms.length > 0) {
  try {
    const orConditions = searchTerms
      .map((term: string) => `chunk_text.ilike.%${term}%`)
      .join(',');
    
    console.log("ILIKE query conditions:", orConditions);
    
    const { data: ilikeData, error: ilikeError } = await supabase
      .from("search_chunks")
      .select(`
        id,
        project_id,
        source_type,
        source_id,
        chunk_text,
        chunk_index,
        metadata,
        projects!inner(name)
      `)
      .in("project_id", targetProjectIds)
      .or(orConditions)
      .limit(12);

    if (ilikeError) {
      console.error("ILIKE search error:", ilikeError.message);
    } else if (ilikeData) {
      searchResults = ilikeData;
      console.log("ILIKE found:", ilikeData.length, "results");
    } else {
      console.log("ILIKE returned no data");
    }
  } catch (err) {
    console.error("ILIKE search exception:", err);
  }
}
```

## Ordem de Implementacao

1. Atualizar funcao `rag-answer` com normalizacao de termos
2. Adicionar logs de erro detalhados
3. Fazer deploy da edge function
4. Testar com a mesma query que falhou anteriormente

## Resultado Esperado

Apos a correcao:

| Query Original | Termos Normalizados |
|----------------|---------------------|
| `"TEG."` | `"teg"` |
| `"Paulo,"` | `"paulo"` |
| `"promissora."` | `"promissora"` |
| 35 termos duplicados | ~10 termos unicos |

Isso deve permitir que a busca ILIKE encontre os 31+ chunks relevantes e retorne respostas uteis ao inves de "Nao encontrei informacoes".

## Beneficios

1. **Robustez** - Queries com pontuacao nao quebram a busca
2. **Performance** - Menos termos = queries mais rapidas
3. **Debug** - Logs de erro facilitam diagnostico futuro
4. **Qualidade** - Termos normalizados melhoram precisao da busca
