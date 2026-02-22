

# Plano: Implementar "Gating" com Constraints e Evidence Check no Roteamento

## Resumo

O roteamento atual escolhe pipeline com base em intent (keywords), mas nao verifica se existem dados no projeto para as constraints da pergunta. Isso permite que o modo Comparative (ou Standard) responda com dados globais/genericos quando a pergunta tem constraints fortes (ex: "Vitality + prata") e nao existe evidencia alguma no projeto.

A solucao: adicionar uma camada de "gating" com 3 componentes:
1. `extractConstraints()` -- extrai materiais, aditivos e propriedades da query
2. `quickEvidenceCheck()` -- verifica se existe evidencia minima no projeto para as constraints
3. Logica de `fail_closed` quando constraints fortes nao tem evidencia

## O que muda

### 1. Nova funcao `extractConstraints(query)`

Extrai heuristicamente:
- `materials`: ["vitality", "filtek", etc.] via regex/dicionario
- `additives`: ["silver_nanoparticles", "bomar", etc.] via regex
- `properties`: ["flexural_strength", "color", etc.] via keywords
- `hasStrongConstraints`: true se >= 2 entidades detectadas

Sem LLM, sem custo. Dicionario hardcoded com termos PT/EN.

### 2. Nova funcao `quickEvidenceCheck(supabase, projectIds, constraints)`

Para cada constraint detectada, faz queries baratas (COUNT ou EXISTS):
- **Material**: busca em `experiment_conditions` (key in material/resin, value ilike), `experiments` (title/objective FTS), `search_chunks` (chunk_text ilike), `measurements` (source_excerpt ilike)
- **Aditivo**: mesma estrategia (silver/prata/ag/nanopart)
- **Propriedade "color"**: busca em `measurements` (metric ilike color/yellowing/delta_e), `search_chunks` (chunk_text ilike)

Retorna `false` se QUALQUER constraint forte nao tiver NENHUM sinal no projeto.

Maximo de 4-6 queries ao banco, todas com LIMIT 1.

### 3. Alteracao no roteamento (bloco principal do rag-answer)

Pseudocodigo do novo fluxo:

```text
1. detectTabularExcelIntent(query)
   -> se true: TABULAR MODE (sem mudanca)

2. detectIDERIntent(query)
   -> se true: IDER MODE (sem mudanca)

3. detectComparativeIntent(query)
   -> se true:
      a. extractConstraints(query)
      b. se hasStrongConstraints:
         - quickEvidenceCheck(projectIds, constraints)
         - se false: FAIL_CLOSED (nao responder ranking global)
         - se true: COMPARATIVE_CONSTRAINED (filtrar current_best por material/aditivo/metrica)
      c. se !hasStrongConstraints: COMPARATIVE (atual, sem mudanca)

4. Standard pipeline (sem mudanca)
```

### 4. Nova rota `fail_closed`

Retorna mensagem estruturada:
- O que foi pedido (constraints detectadas)
- O que nao existe no projeto
- O que o usuario precisa fornecer (arquivo/aba/nome do experimento)

Formato identico ao fail-closed do tabular e IDER.

### 5. Comparative constrained: filtrar dados

Quando comparative passa no evidence check mas tem constraints fortes, filtrar `current_best` e `measurements` por:
- material (via experiment_conditions ou experiments.title)
- aditivo (via experiment_conditions)
- metrica especifica

Se apos filtro nao sobrar nada: fail_closed.

### 6. Logging

`rag_logs` inclui:
- `pipeline_selected`: com novos valores `comparative-constrained` e `fail-closed-no-evidence`
- `constraints_detected`: JSON com materials/additives/properties
- `evidence_check_passed`: boolean

## Arquivos alterados

1. `supabase/functions/rag-answer/index.ts`:
   - Adicionar `extractConstraints()`
   - Adicionar `quickEvidenceCheck()`
   - Alterar bloco de comparative mode (linhas ~2001-2033) para incluir gating
   - Adicionar retorno fail_closed para comparative sem evidencia
   - Alterar `runComparativeMode()` para aceitar filtros de constraints

## O que NAO muda

- Tabular mode (inalterado)
- IDER mode (inalterado)
- Standard pipeline (inalterado)
- Nenhuma migracao SQL necessaria
- Nenhum componente frontend alterado

## Secao tecnica

### extractConstraints -- dicionario

```text
materials: vitality, filtek, charisma, tetric, grandio, z350, z250, brilliant, herculite, clearfil, estelite, ips, ceram
additives: (prata|silver|ag|nanopart), bomar, tegdma, udma, bisgma, bis-gma
properties: flexural->flexural_strength, dureza/vickers->hardness, sorcao/sorption->water_sorption, cor/color/yellowing->color, conversao/conversion->degree_of_conversion, modulo/modulus->elastic_modulus
```

### quickEvidenceCheck -- queries

Para cada constraint, executa no maximo 4 queries em paralelo (Promise.all), todas com `.limit(1).select('id')`. Retorna `false` ao primeiro constraint sem hit.

### runComparativeMode filtrado

Adicionar parametro `constraints` a `runComparativeMode()`. Quando presente:
- Filtrar `current_best` por experiment_id que tenha conditions matching material/aditivo
- Ou filtrar por FTS no experiment_title

