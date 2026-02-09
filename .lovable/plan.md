
# Integrar Dados Estruturados nos Componentes Pendentes

## Problema

O `rag-answer` ja usa experiments/measurements para montar respostas. Porem tres funcoes e um componente ainda ignoram os dados estruturados:

1. `analyze-document` -- nao consulta experiments/measurements do arquivo
2. `save-analysis-insights` -- nao salva experiments estruturados, apenas knowledge_items
3. `rag-answer` sources -- nao inclui fontes de experiments na resposta
4. `SourcesPanel` -- nao reconhece source_type "experiment"

---

## Mudanca 1: `analyze-document` -- incluir dados estruturados

Apos carregar chunks e knowledge_items, tambem consultar:
- `experiments` filtrados por `source_file_id = file_id` e `deleted_at IS NULL`
- `measurements` via experiment_id
- `experiment_conditions` via experiment_id

Adicionar ao prompt uma secao "Dados Estruturados Extraidos" com a tabela de medicoes formatada, para que a analise profunda considere os valores ja extraidos e possa complementar/corrigir.

---

## Mudanca 2: `save-analysis-insights` -- tambem salvar experiments

Apos extrair knowledge_items (fluxo atual), adicionar uma segunda chamada de IA pedindo extracao de experiments no formato JSON estruturado (mesmo formato usado pelo `extract-knowledge`).

Salvar atomicamente: experiment -> measurements -> conditions -> citations. Reutilizar a logica de validacao anti-alucinacao (value numerico + unit + source_excerpt).

---

## Mudanca 3: `rag-answer` -- incluir experiment sources na resposta

Quando o `fetchExperimentContext` retorna dados relevantes, criar entradas de sources adicionais vinculadas ao arquivo de origem do experiment. Formato:

```
{ citation: "[E1]", type: "experiment", id: experiment.id, title: experiment.title, project: project.name, excerpt: "3 medicoes: flexural_strength 131 MPa, ..." }
```

Concatenar com as sources de chunks existentes para que o frontend mostre ambas.

---

## Mudanca 4: `SourcesPanel` -- reconhecer experiments

Adicionar ao `sourceTypeConfig`:
```
experiment: { icon: FlaskConical, label: 'Experimento', color: 'text-cyan-500' }
```

---

## Ordem de execucao

1. Atualizar `analyze-document` (consultar experiments + enriquecer prompt)
2. Atualizar `save-analysis-insights` (extrair e salvar experiments estruturados)
3. Atualizar `rag-answer` (incluir experiment sources)
4. Atualizar `SourcesPanel` (novo tipo experiment)

## Detalhes tecnicos

- Reutilizar mesma logica de `saveExperiments` do `extract-knowledge` no `save-analysis-insights` (duplicar a funcao ou extrair para modulo compartilhado)
- Manter compatibilidade: knowledge_items continuam sendo salvos normalmente
- As sources de experiments usam prefixo `[E1]`, `[E2]` para diferenciar de chunks `[1]`, `[2]`
