
# Plano: Suporte a DOCX e Opcao de Reprocessar Arquivos

## Problema Identificado

O arquivo "Solicitacao de Alteracao Vitality para Teste.docx" foi enviado mas nao gerou nenhum insight porque a funcao de extracao nao suporta o formato DOCX (Word). O sistema marcou como "unsupported" e encerrou sem processar. Alem disso, nao existe uma opcao na interface para reprocessar um arquivo que falhou.

## Mudancas Planejadas

### 1. Adicionar Suporte a DOCX na Funcao de Extracao

**Arquivo:** `supabase/functions/extract-knowledge/index.ts`

Adicionar um parser de DOCX usando a biblioteca `mammoth` (disponivel via esm.sh) que converte documentos Word em texto puro. O parser sera adicionado junto aos handlers existentes de Excel, CSV, PDF e texto.

A logica sera:
- Detectar MIME type `application/vnd.openxmlformats-officedocument.wordprocessingml.document` ou extensao `.docx`
- Usar `mammoth.extractRawText()` para extrair o texto do documento
- Classificar a qualidade do parsing baseado no tamanho do texto extraido
- Enviar o texto para a IA para analise, da mesma forma que os outros formatos

### 2. Adicionar Botao de Reprocessar na Interface

**Arquivo:** `src/components/knowledge/ExtractionStatus.tsx` (componente ExtractionBadge)

Quando um arquivo tem status "completed" com 0 insights ou status "failed", adicionar um botao "Reprocessar" que:
- Cria um novo registro em `extraction_jobs` para o arquivo
- Chama a funcao `extract-knowledge` novamente
- Atualiza o badge para mostrar o novo status de processamento

**Arquivo:** `src/components/files/ProjectFilesList.tsx`

Adicionar uma opcao de "Reprocessar" no menu de acoes de cada arquivo na lista.

### Detalhes Tecnicos

| Arquivo | Tipo de Mudanca |
|---------|----------------|
| `supabase/functions/extract-knowledge/index.ts` | Adicionar handler DOCX com mammoth |
| `src/components/knowledge/ExtractionStatus.tsx` | Botao reprocessar no ExtractionBadge |
| `src/components/files/ProjectFilesList.tsx` | Opcao reprocessar no menu de acoes |

### Fluxo de Reprocessamento

1. Usuario clica em "Reprocessar" no badge ou menu do arquivo
2. Sistema cria novo `extraction_job` com status "pending"
3. Sistema chama a Edge Function `extract-knowledge` com o file_id e novo job_id
4. ExtractionBadge detecta o job pendente e mostra o progresso
5. Ao completar, os insights aparecem automaticamente na Base de Conhecimento

### Seguranca

- RLS de `extraction_jobs` ja permite criacao por researchers (`Researchers can create extraction jobs`)
- A funcao `extract-knowledge` ja verifica permissao de membro do projeto
- Nenhuma mudanca de esquema necessaria
