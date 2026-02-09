
# Pipeline de Conhecimento Estruturado - Implementacao

## Resumo

Transformar o pipeline atual (que extrai apenas "insights soltos" via IA) em um sistema com 6 melhorias concretas: parser direto para Excel, fallback qualitativo para PDF/Word, idempotencia via fingerprint, status formal por arquivo, catalogo de metricas, e prompt anti-alucinacao reforçado.

---

## 1. Migracao de Banco de Dados

Criar as seguintes estruturas em uma unica migracao SQL:

### 1.1 Tabela `experiments`
Representa um teste/iteracao tecnica extraido de um documento.

| Coluna | Tipo | Notas |
|--------|------|-------|
| id | uuid PK | gen_random_uuid() |
| project_id | uuid FK projects | NOT NULL |
| source_file_id | uuid FK project_files | NOT NULL |
| extraction_job_id | uuid FK extraction_jobs | nullable |
| title | text | NOT NULL |
| objective | text | nullable |
| summary | text | nullable |
| source_type | text | pdf, word, excel |
| is_qualitative | boolean | default false |
| extracted_by | uuid | NOT NULL |
| created_at | timestamptz | default now() |
| deleted_at | timestamptz | soft delete |

RLS: mesmas regras que knowledge_items (membros veem, researchers criam, managers deletam).

### 1.2 Tabela `measurements`

| Coluna | Tipo | Notas |
|--------|------|-------|
| id | uuid PK | |
| experiment_id | uuid FK experiments | NOT NULL |
| metric | text | ex: flexural_strength |
| value | numeric | NOT NULL |
| unit | text | NOT NULL |
| method | text | nullable (ISO 4049) |
| notes | text | nullable |
| confidence | text | high/medium/low |
| source_excerpt | text | trecho exato obrigatorio |
| created_at | timestamptz | |

RLS: acesso herdado via experiment -> project_id.

### 1.3 Tabela `experiment_conditions`

| Coluna | Tipo |
|--------|------|
| id | uuid PK |
| experiment_id | uuid FK |
| key | text (monomer, post_cure, printer...) |
| value | text |

RLS: herdada via experiment.

### 1.4 Tabela `experiment_citations`

| Coluna | Tipo |
|--------|------|
| id | uuid PK |
| experiment_id | uuid FK |
| measurement_id | uuid FK nullable |
| file_id | uuid FK project_files |
| page | integer nullable |
| sheet_name | text nullable |
| cell_range | text nullable |
| excerpt | text NOT NULL |
| chunk_id | uuid FK search_chunks nullable |

RLS: herdada via experiment.

### 1.5 Tabela `metrics_catalog`

Catalogo canonico de metricas com aliases para normalizacao.

| Coluna | Tipo |
|--------|------|
| id | uuid PK |
| canonical_name | text UNIQUE | ex: flexural_strength |
| display_name | text | ex: Resistencia Flexural |
| unit | text | ex: MPa |
| aliases | text[] | ex: {flexural_strength, rf, res_flexural} |
| category | text | mechanical, optical, chemical... |

Preencher com metricas iniciais comuns em P&D odontologico: flexural_strength, water_sorption, hardness, delta_e, degree_of_conversion, etc.

### 1.6 Coluna `content_fingerprint` em `project_files`

```sql
ALTER TABLE project_files ADD COLUMN content_fingerprint text;
CREATE UNIQUE INDEX idx_files_fingerprint_project 
  ON project_files(project_id, content_fingerprint) 
  WHERE deleted_at IS NULL AND content_fingerprint IS NOT NULL;
```

### 1.7 Coluna `fingerprint` em `extraction_jobs`

```sql
ALTER TABLE extraction_jobs ADD COLUMN content_fingerprint text;
```

Isso permite detectar reprocessamento duplicado.

---

## 2. Excel: Parser Direto + IA so para Mapeamento

### Logica no `extract-knowledge`

Para arquivos Excel, o pipeline atual ja usa SheetJS para gerar texto CSV. A mudanca:

1. **Parser direto**: Ler cada aba com `XLSX.utils.sheet_to_json()` em vez de `sheet_to_csv()`. Preservar cada linha como objeto estruturado.
2. **IA so para mapeamento**: Enviar apenas o cabecalho (primeiras 3 linhas) para a IA, pedindo que identifique qual coluna e metrica, qual e unidade, qual e condicao, etc. Retorno via tool calling.
3. **Gerar measurements diretamente**: Iterar pelas linhas usando o mapeamento da IA. Cada celula numerica relevante vira um `measurement` com `source_excerpt` = "Sheet: X, Cell: Y, Value: Z".
4. **Gerar experiment por aba** (ou por grupo logico identificado pela IA).
5. **Citations automaticas**: sheet_name + cell_range para cada measurement.

```text
Fluxo Excel:
  SheetJS parse -> headers para IA (mapeamento) -> iterar linhas -> measurements diretos
  IA NAO ve os dados numericos, so mapeia colunas
```

### Fingerprint Excel
Gerar hash SHA-256 do conteudo do ArrayBuffer. Salvar em `project_files.content_fingerprint`. Antes de extrair, verificar se ja existe extraction_job com mesmo fingerprint e status "completed" -- se sim, pular.

---

## 3. PDF/Word: Fallback Qualitativo + Citation

### Logica no `extract-knowledge`

Quando o parser de PDF/Word nao consegue extrair tabelas (parsingQuality != "good" ou sem numeros detectados):

1. Marcar o experiment como `is_qualitative = true`
2. Criar citations com page number (PDF) ou secao (Word)
3. O prompt de extracao ja pede evidencia -- reforcar que se nao ha tabela, o experiment e qualitativo
4. Para PDFs com tabelas detectaveis (linhas com numeros separados por espacos/tabs), tentar parse simples via regex antes de enviar para IA

### Fallback explicito
Se `parsingQuality === "partial"` ou `"poor"`:
- Criar 1 experiment qualitativo com summary = "Documento sem dados quantitativos extraiveis"
- Criar citation com excerpt do primeiro trecho legivel
- Nao criar measurements

---

## 4. Idempotencia: Fingerprint + Unique Constraint

### No upload (`FileUploadModal` + `extract-knowledge`)

1. Ao fazer upload, calcular SHA-256 do conteudo do arquivo
2. Salvar em `project_files.content_fingerprint`
3. Antes de criar extraction_job, verificar:
   - Existe extraction_job com mesmo `content_fingerprint` e `status = 'completed'`?
   - Se sim: retornar resultado anterior sem reprocessar
4. No reprocessamento (`useReprocessFile`): permitir bypass do check (flag `force = true`)

### Unique constraint
O indice unico `(project_id, content_fingerprint)` onde `deleted_at IS NULL` impede upload duplicado do mesmo conteudo no mesmo projeto.

---

## 5. Pipeline: Status Formal por Arquivo

### Status no frontend

Criar componente `FileExtractionBadge` que mostra o status do ultimo extraction_job para cada arquivo:

- **pending**: Aguardando processamento (amarelo)
- **processing**: Extraindo... (azul, animado)
- **completed**: X insights extraidos (verde)
- **failed**: Erro (vermelho, com mensagem)

Usar na lista de arquivos (`ProjectFilesList`) e no `FileDetailModal`.

Query: buscar ultimo extraction_job por file_id, ordenado por created_at desc.

---

## 6. Metricas: Catalogo + Normalizacao

### `metrics_catalog` pre-populado

Inserir na migracao ~15 metricas comuns:

| canonical_name | display_name | unit | aliases |
|---|---|---|---|
| flexural_strength | Resistencia Flexural | MPa | {rf, flexural, res_flexural} |
| water_sorption | Sorcao de Agua | ug/mm3 | {ws, sorcao, absorcao} |
| hardness_vickers | Dureza Vickers | HV | {hv, vickers} |
| delta_e | Variacao de Cor (Delta E) | - | {de, deltaE, cor} |
| degree_of_conversion | Grau de Conversao | % | {dc, gc, conversao} |
| ... | ... | ... | ... |

### Normalizacao no pipeline

Ao salvar measurements, buscar no catalogo se a metrica informada pela IA corresponde a algum alias. Se sim, usar o `canonical_name`. Se nao, criar entrada no catalogo automaticamente.

---

## 7. Prompt Anti-Alucinacao Reforçado

### Regra para measurements

No prompt do `extract-knowledge`, adicionar regra explicita:

```
REGRA PARA MEASUREMENTS (OBRIGATORIA):
- Um measurement so pode ser criado se houver:
  1. Um numero explicito no documento
  2. Uma unidade associada (ou inferivel pelo contexto da coluna)
  3. Um trecho citavel que contenha o numero
- Se faltar qualquer um dos 3, NAO criar measurement
- Preferir ZERO measurements a UM fabricado
```

### Validacao pos-IA

Apos receber os experiments/measurements da IA:
1. Verificar que `value` e numerico valido
2. Verificar que `unit` nao esta vazio
3. Verificar que `source_excerpt` contem o valor numerico (busca textual)
4. Se falhar qualquer check, descartar o measurement (nao o experiment inteiro)

---

## 8. Atualizacao do RAG (`rag-answer`)

### Busca priorizada

Alem dos search_chunks, consultar:
1. `experiments` + `measurements` + `conditions` para os projetos do usuario
2. Formatar como contexto tabular no prompt

### Formato de resposta obrigatorio

Atualizar o system prompt:

```
1. Sintese tecnica (resumo factual)
2. Evidencias (tabela: Experimento | Condicao | Metrica | Resultado | Fonte)
3. Heuristicas derivadas (regra + confianca)
4. Lacunas (o que nao foi medido)
5. Fontes (lista numerada com arquivo + pagina/planilha)
```

Se nao houver measurements: "Nao encontrei medicoes quantitativas registradas."

---

## 9. Frontend: Visualizacao de Experimentos

### Knowledge page
- Adicionar filtro `entryType = 'experiments'` em `KnowledgeFilters`
- Criar `ExperimentCard`: titulo, objetivo, badges de condicoes, contagem de medicoes, fonte
- Criar `ExperimentDetailModal`: tabela de medicoes (metric | value | unit | method | confidence), condicoes, citations com links

### ChatMessage
- Garantir que `react-markdown` renderize tabelas com estilos (table/thead/tbody/tr/th/td com classes Tailwind)

### FileDetailModal / ProjectFilesList
- Mostrar `FileExtractionBadge` com status do pipeline

---

## Ordem de Execucao

1. Migracao SQL (tabelas + metricas iniciais + fingerprint + RLS)
2. Atualizar `extract-knowledge`: parser Excel direto, fallback qualitativo, fingerprint, anti-alucinacao, salvar experiments/measurements/conditions/citations
3. Atualizar `save-analysis-insights`: tambem extrair experiments estruturados
4. Atualizar `rag-answer`: busca priorizada + formato de resposta
5. Criar componentes frontend (ExperimentCard, ExperimentDetailModal, FileExtractionBadge)
6. Atualizar Knowledge page (filtro experiments)
7. Atualizar ChatMessage (render de tabelas)
8. Atualizar FileUploadModal (calcular fingerprint)
9. Atualizar useReprocessFile (flag force)

---

## Detalhes Tecnicos

- **Modelo IA**: google/gemini-2.5-flash (mapeamento Excel) e google/gemini-3-flash-preview (extracao de experimentos de PDF/Word)
- **Volume**: ~100 arquivos, ~200 experiments, ~1000 measurements. Sem overengineering.
- **Compatibilidade**: knowledge_items existentes continuam funcionando. Experiments sao camada adicional.
- **RBAC**: Todas as novas tabelas usam `is_project_member` e `has_project_role` via funcoes SQL existentes.
