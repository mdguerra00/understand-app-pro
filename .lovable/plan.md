
# Plano: Guardrails Anti-Alucinacao para Relatorios de IA

## Diagnostico do Problema

O gerador de relatorios atual (`generate-report/index.ts`) possui guardrails fracos que permitem a IA:

1. **Inventar conclusoes e interpretacoes** que nao estao nos insights
2. **Adicionar contexto cientifico proprio** (correlacoes "esperadas", conhecimento de ciencia de materiais)
3. **Fazer recomendacoes especulativas** sem base nos dados experimentais

O prompt atual apenas diz "NAO invente dados", mas a IA entende "dados" como numeros, nao como analises.

## Solucao Proposta

Reescrever completamente o sistema de prompts com guardrails rigorosos de **zero-trust**, similar ao que ja existe na extracao de conhecimento.

---

## Alteracoes no Edge Function

### Arquivo: `supabase/functions/generate-report/index.ts`

### 1. Novo System Prompt com Anti-Alucinacao

```typescript
const systemPrompt = `Voce e um redator tecnico que sintetiza dados de P&D.

## REGRA ABSOLUTA - ZERO ALUCINACAO:

1. Voce so pode escrever afirmacoes que estao EXPLICITAMENTE nos insights fornecidos
2. NUNCA adicione conhecimento proprio sobre ciencia de materiais, quimica ou odontologia
3. NUNCA use frases como "conforme esperado", "como se sabe", "correlacao conhecida"
4. NUNCA faca recomendacoes que NAO estejam nos insights
5. Se nao houver dados suficientes, diga "dados insuficientes" em vez de inventar

## ESTRUTURA OBRIGATORIA:

Para cada afirmacao no relatorio:
- CITE a fonte: "Conforme insight X: [afirmacao direta]"
- Use APENAS valores numericos que aparecem nos insights
- Se dois insights parecem se relacionar, diga "os dados sugerem" NAO "confirma-se"

## O QUE VOCE NAO PODE FAZER:

- Inventar correlacoes (ex: "correlacao inversa esperada")
- Adicionar teoria cientifica nao mencionada
- Fazer recomendacoes especulativas
- Usar seu conhecimento de quimica/materiais
- Tirar conclusoes alem dos dados

## O QUE VOCE PODE FAZER:

- Organizar os insights por categoria
- Citar valores exatos dos insights
- Resumir o que os insights dizem LITERALMENTE
- Apontar lacunas nos dados
- Marcar areas que precisam de mais pesquisa

## FORMATO ESPERADO:

### Secao X
Conforme os dados experimentais [citar insight]:
- Resultado A: [valor exato]
- Resultado B: [valor exato]

**Observacao:** [apenas se estiver nos insights]
**Limitacao:** [o que os dados NAO mostram]`;
```

### 2. Incluir Evidencias dos Insights no Prompt

Atualmente o prompt inclui os insights mas nao suas evidencias verificadas. Vamos adicionar um campo de `evidence_verified` para cada insight, e incluir avisos quando insights nao verificados sao usados.

```typescript
for (const item of items) {
  insightsText += `- **${item.title}**\n`;
  insightsText += `  Conteudo: ${item.content}\n`;
  insightsText += `  Confianca: ${item.confidence}%\n`;
  if (item.evidence) {
    insightsText += `  Evidencia Original: "${item.evidence}"\n`;
  }
  if (item.evidence_verified === false) {
    insightsText += `  [!] AVISO: Evidencia nao verificada no documento original\n`;
  }
  insightsText += `  Fonte: ${fileName}\n\n`;
}
```

### 3. Nova Tool Definition com Campos de Citacao

Atualizar o schema da tool para exigir citacoes explicitas:

```typescript
tools: [
  {
    type: "function",
    function: {
      name: "create_report",
      parameters: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          resumo: { 
            type: "string",
            description: "Resumo que cita APENAS dados dos insights, sem adicoes" 
          },
          conteudo: { 
            type: "string",
            description: "Relatorio com citacoes explicitas [Insight: titulo]. Sem interpretacoes proprias." 
          },
          limitacoes: {
            type: "string",
            description: "Lista do que os dados NAO mostram e areas que precisam mais pesquisa"
          }
        },
        required: ["titulo", "resumo", "conteudo", "limitacoes"]
      }
    }
  }
]
```

### 4. Adicionar Secao de Limitacoes no Relatorio

O relatorio final devera incluir uma secao de "Limitacoes" gerada pela IA, que lista o que os dados nao mostram.

---

## Alteracoes na Interface

### Arquivo: `src/components/reports/ReportEditorModal.tsx`

Adicionar badge visual quando o relatorio foi gerado por IA, indicando que precisa de revisao:

```tsx
{report.generated_by_ai && (
  <Alert variant="warning">
    <AlertCircle className="h-4 w-4" />
    <AlertDescription>
      Este relatorio foi gerado automaticamente. 
      Revise todas as conclusoes antes de aprovar.
    </AlertDescription>
  </Alert>
)}
```

---

## Comparacao: Antes vs Depois

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Conclusoes | "Confirmou-se correlacao inversa" | "Os insights indicam valores de X e Y" |
| Recomendacoes | Especulativas baseadas em teoria | Apenas as listadas nos insights |
| Citacoes | Vagas ou ausentes | "[Insight: Nome] mostra que..." |
| Limitacoes | Nenhuma | Secao obrigatoria |
| Revisao | Opcional | Aviso explicito para revisar |

---

## Arquivos a Modificar

| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/generate-report/index.ts` | Reescrever prompts com guardrails anti-alucinacao |
| `src/components/reports/ReportEditorModal.tsx` | Adicionar aviso de revisao para relatorios IA |

---

## Ordem de Implementacao

1. Reescrever o system prompt no edge function com regras anti-alucinacao
2. Incluir campo `evidence_verified` no prompt
3. Atualizar tool schema para exigir citacoes e limitacoes
4. Adicionar banner de revisao no modal de edicao
5. Testar gerando um novo relatorio

---

## Resultado Esperado

O relatorio gerado sera muito mais conservador e factual:

**Antes:**
> "Confirmou-se a correlacao inversa esperada: sistemas baseados em BISEMA aumentam significativamente a ductilidade..."

**Depois:**
> "Conforme o insight 'Elevada Ductilidade no Sistema BISEMA+IBOMA', a mistura BISEMA+IBOMA registrou alongamento de 26,2%. Em contraste, o insight 'Baixa Resistencia em Formulacoes de BISEMA Puro' indica RF de 5 MPa para BISEMA+THF. **Nota:** Os dados nao demonstram correlacao estatistica; observam-se apenas valores individuais."
