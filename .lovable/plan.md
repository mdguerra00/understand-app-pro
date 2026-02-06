
# Plano: Corrigir erro "Failed to fetch" no Assistente IA

## Problema Identificado

A funcao backend `rag-answer` existe no codigo mas **nao esta implantada** no servidor. Quando o assistente tenta enviar sua pergunta, recebe um erro 404 (funcao nao encontrada), que resulta na mensagem "Failed to fetch".

## Solucao

Implantar a funcao `rag-answer` no servidor. Nenhuma mudanca de codigo e necessaria -- apenas o deploy da funcao existente.

## Detalhes Tecnicos

| Item | Detalhe |
|------|---------|
| Causa raiz | Funcao `rag-answer` nao deployada (retorna 404) |
| Acao | Deploy da edge function `rag-answer` |
| Mudanca de codigo | Nenhuma |
| Segredos necessarios | `PERPLEXITY_API_KEY` - ja configurado |
