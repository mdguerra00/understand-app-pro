
# Plano: Aumentar Limite de Caracteres para Processamento de Planilhas Excel

## Contexto

O sistema de extração de conhecimento atualmente limita o conteúdo processado a **60.000 caracteres**. Para planilhas Excel com múltiplas abas e dados extensos, esse limite pode causar truncamento, perdendo informações importantes das últimas abas.

## Mudança Proposta

Aumentar o limite de **60.000** para **120.000 caracteres** (dobrar a capacidade).

### Considerações Técnicas

| Aspecto | Valor Atual | Novo Valor | Impacto |
|---------|-------------|------------|---------|
| Limite de caracteres | 60.000 | 120.000 | +100% de conteúdo |
| Tokens estimados (÷4) | ~15.000 | ~30.000 | Dentro do limite do modelo |
| Custo por extração | Baseline | ~2x | Aceitável para arquivos maiores |

O modelo **Gemini 3 Flash Preview** suporta contextos de até 1 milhão de tokens, então 30.000 tokens (~120k chars) está bem dentro do limite seguro.

## Arquivo a Modificar

| Arquivo | Linha | Mudança |
|---------|-------|---------|
| `supabase/functions/extract-knowledge/index.ts` | 340 | `maxChars = 60000` → `maxChars = 120000` |

## Código da Alteração

```typescript
// Antes (linha 340)
const maxChars = 60000;

// Depois
const maxChars = 120000;
```

A mensagem de truncamento será atualizada automaticamente pois já usa a variável `maxChars`:
```typescript
textContent = textContent.substring(0, maxChars) + 
  `\n\n[⚠️ CONTEÚDO TRUNCADO: O arquivo original contém ${Math.ceil(textContent.length / 1000)}k caracteres. Apenas os primeiros ${maxChars / 1000}k foram processados pela IA.]`;
```

## Resultado Esperado

- Planilhas com até ~120.000 caracteres serão processadas completamente
- Todas as abas de planilhas Excel de tamanho médio/grande serão lidas
- Mensagem de truncamento continua funcionando para arquivos que excedam o novo limite
