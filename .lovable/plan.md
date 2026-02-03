

# Plano: Corrigir Extração de Conhecimento para PDFs

## Diagnóstico do Problema

A função `extract-knowledge` está falhando com dois erros críticos ao processar PDFs:

1. **`Maximum call stack size exceeded`** - O loop de conversão base64 para PDFs grandes cria strings enormes
2. **`Deno.core.runMicrotasks() is not supported`** - Erro de incompatibilidade com o ambiente Deno Edge

### Problema Identificado no Código

Na linha 298, após gerar o base64, o código **NÃO usa** a variável `base64`:

```typescript
// Linha 298 - base64 gerado mas não utilizado!
textContent = `[PDF Document: ${fileData.name}]\n\nBase64 content available...`;
```

O PDF nunca é realmente enviado para análise - apenas uma mensagem placeholder é enviada.

## Solução Proposta

Usar a biblioteca `pdf-parse` compatível com Deno para extrair texto do PDF de forma nativa, sem necessidade de conversão base64.

### Mudanças Técnicas

| Arquivo | Mudança |
|---------|---------|
| `supabase/functions/extract-knowledge/index.ts` | Importar e usar biblioteca de parsing de PDF |

### Implementação

1. **Adicionar import de pdf-parse compatível com Deno**:
```typescript
import pdf from "https://esm.sh/pdf-parse@1.1.1";
```

2. **Substituir lógica de PDF (linhas 280-299)**:
```typescript
} else if (mimeType === "application/pdf") {
  try {
    const arrayBuffer = await fileContent.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const pdfData = await pdf(buffer);
    textContent = `[PDF Document: ${fileData.name}]\n\n${pdfData.text}`;
    parsingQuality = pdfData.text.length > 100 ? "good" : "partial";
  } catch (pdfError) {
    console.error("PDF parsing error:", pdfError);
    textContent = `[AVISO: Erro ao processar PDF: ${fileData.name}]`;
    parsingQuality = "failed";
  }
}
```

3. **Remover código de base64 que causa stack overflow**

## Alternativa: Usar API de Visão (Multimodal)

Se a biblioteca `pdf-parse` não funcionar bem no Deno Edge, podemos usar o Gemini com capacidade multimodal para ler PDFs diretamente como imagens. Isso envolveria:

1. Converter cada página do PDF para imagem
2. Enviar as imagens para a API Gemini com análise visual

Esta é uma alternativa mais complexa, mas mais robusta para PDFs com formatação complexa.

## Resultado Esperado

- PDFs de 20+ páginas serão processados sem erro de stack overflow
- Texto será extraído e enviado para análise da IA
- Insights serão gerados corretamente

