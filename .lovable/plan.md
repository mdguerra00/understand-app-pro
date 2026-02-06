

# Plano: Tornar a IA mais inteligente com analise cross-document e relacionamentos

## Problema Atual

O sistema hoje trabalha de forma **isolada por documento**: quando um arquivo e processado, a IA extrai insights individuais (findings, correlations, etc.) sem considerar o que ja existe na base de conhecimento. O resultado sao fragmentos desconectados que nao se relacionam entre si.

Alem disso, a busca do assistente RAG usa apenas texto literal (FTS/ILIKE), sem compreensao semantica -- ou seja, se voce pergunta "quais materiais tem melhor resistencia?", ele so encontra resultados que contenham exatamente essas palavras.

## Solucao Proposta (3 Melhorias)

### 1. Embeddings Semanticos para Busca Inteligente

Adicionar geracao de embeddings (vetores numericos que capturam significado) a cada chunk de texto indexado. Isso permite que o assistente encontre informacoes relevantes mesmo quando as palavras sao diferentes.

**Exemplo pratico:** Perguntar "dureza dos compositos" encontraria chunks que falam sobre "resistencia Vickers de resinas compostas" -- algo impossivel com busca textual.

- Usar o Lovable AI Gateway para gerar embeddings ao indexar conteudo
- A funcao de busca hibrida (`search_chunks_hybrid`) ja existe no banco mas nao e usada porque os embeddings nunca sao gerados

### 2. Analise Cross-Document com Relacionamentos

Criar uma nova etapa pos-extracao que analisa os insights recem-extraidos em conjunto com os insights ja existentes no projeto. A IA identificara:

- **Relacoes entre documentos**: "O material X testado no Doc A aparece com resultados diferentes no Doc B"
- **Padroes recorrentes**: "3 documentos diferentes confirmam a mesma tendencia"
- **Contradicoes**: "Doc A diz X, mas Doc B diz Y"
- **Lacunas**: "Temos dados de resistencia mas nenhum de biocompatibilidade"

Essas relacoes serao salvas como novos insights com categoria especial, linkando aos insights originais.

### 3. Assistente RAG com Busca Hibrida e Lovable AI

Migrar o assistente de Perplexity para Lovable AI (ja disponivel e sem custo adicional de API key) e ativar busca hibrida (semantica + texto), resultando em respostas muito mais completas e contextualizadas.

## Detalhes Tecnicos

### Mudanca 1: Gerar Embeddings no index-content

**Arquivo:** `supabase/functions/index-content/index.ts`

- Apos criar cada chunk, chamar Lovable AI Gateway para gerar embedding do texto
- Salvar o vetor na coluna `embedding` (ja existe na tabela `search_chunks`)
- Os 41 chunks existentes serao reprocessados quando o projeto for reindexado

### Mudanca 2: Nova etapa cross-document no extract-knowledge

**Arquivo:** `supabase/functions/extract-knowledge/index.ts`

- Apos extrair insights de um documento, buscar insights existentes do mesmo projeto
- Enviar ambos (novos + existentes) para a IA com prompt especifico para identificar relacoes
- Salvar relacoes como novos knowledge_items com categorias: `cross_reference`, `pattern`, `contradiction`, `gap`

### Mudanca 3: Adicionar coluna para relacionamentos

**Migracao SQL:**
- Adicionar coluna `related_items` (uuid[]) na tabela `knowledge_items` para vincular insights relacionados
- Adicionar coluna `relationship_type` (text) para descrever o tipo de relacao
- Adicionar `cross_reference`, `pattern`, `contradiction`, `gap` ao enum de categorias

### Mudanca 4: Migrar RAG para Lovable AI + busca hibrida

**Arquivo:** `supabase/functions/rag-answer/index.ts`

- Substituir Perplexity API por Lovable AI Gateway (google/gemini-3-flash-preview)
- Gerar embedding da pergunta do usuario
- Usar a funcao `search_chunks_hybrid` (ja existe no banco) para busca combinada semantica + FTS
- Aumentar limite de chunks de 12 para 15 para mais contexto

### Mudanca 5: Reindexar conteudo existente

- Trigger de reindexacao para gerar embeddings nos 41 chunks existentes
- Executar analise cross-document nos insights ja extraidos

## Impacto Esperado

| Antes | Depois |
|-------|--------|
| Insights isolados por documento | Insights conectados com relacoes explicitas |
| Busca literal (palavras exatas) | Busca semantica (significado) |
| Perplexity API (custo extra) | Lovable AI (ja incluso) |
| IA nao "aprende" entre docs | IA identifica padroes cross-document |

## Sequencia de Implementacao

1. Migracao SQL (novas colunas + categorias)
2. Atualizar `index-content` com geracao de embeddings
3. Atualizar `extract-knowledge` com analise cross-document
4. Atualizar `rag-answer` com Lovable AI + busca hibrida
5. Deploy das 3 funcoes
6. Reindexar conteudo existente

