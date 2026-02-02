
# Plano: Alerta de Relatorios Desatualizados + Regeneracao com IA

## Resumo da Funcionalidade

Quando novos documentos ou insights sao adicionados ao projeto apos a criacao de um relatorio, o sistema:
1. Detecta automaticamente que o relatorio pode estar desatualizado
2. Exibe um alerta visual informando o usuario
3. Oferece um botao para gerar um novo relatorio atualizado (mantendo o antigo)

---

## Logica de Deteccao

O relatorio sera considerado **potencialmente desatualizado** quando:

| Condicao | Descricao |
|----------|-----------|
| Novos arquivos | `project_files.created_at > report.created_at` |
| Novos insights | `knowledge_items.extracted_at > report.created_at` |
| Novas versoes de arquivo | `project_file_versions.created_at > report.created_at` |

Query de verificacao:
```sql
SELECT 
  (SELECT COUNT(*) FROM project_files 
   WHERE project_id = :project_id 
   AND created_at > :report_created_at 
   AND deleted_at IS NULL) as new_files,
  (SELECT COUNT(*) FROM knowledge_items 
   WHERE project_id = :project_id 
   AND extracted_at > :report_created_at 
   AND deleted_at IS NULL) as new_insights
```

---

## Alteracoes no Frontend

### 1. Novo Componente: `OutdatedReportBanner`

Localizacao: `src/components/reports/OutdatedReportBanner.tsx`

Funcionalidade:
- Recebe `projectId` e `reportCreatedAt` como props
- Consulta o banco para verificar se ha conteudo novo
- Exibe banner amarelo/warning se desatualizado
- Inclui botao "Gerar Nova Versao" que abre o dialog de geracao

Visual do componente:
```text
+----------------------------------------------------------+
| (!) Novos documentos foram adicionados apos este         |
|     relatorio (3 arquivos, 12 insights)                  |
|                                                          |
|     [Gerar Nova Versao com IA]                           |
+----------------------------------------------------------+
```

### 2. Integracao no `ReportEditorModal`

Adicionar o `OutdatedReportBanner` no topo do modal de edicao:
- Visivel apenas para relatorios existentes (nao novos)
- Posicionado entre o header e o conteudo
- Passa `reportCreatedAt` para a verificacao

### 3. Integracao na `ReportsList`

Adicionar indicador visual na listagem:
- Badge "Desatualizado" ao lado do titulo do relatorio
- Usa a mesma logica de deteccao
- Feedback visual rapido sem abrir o modal

---

## Fluxo de Regeneracao

```text
Usuario ve alerta "Relatorio desatualizado"
          |
          v
   Clica "Gerar Nova Versao"
          |
          v
   Abre dialog do GenerateReportButton
   (pre-configurado com mesmo tipo)
          |
          v
   IA gera novo relatorio
   (relatorio antigo permanece intacto)
          |
          v
   Novo relatorio aparece na lista
   com status "Rascunho"
```

---

## Arquivos a Criar/Modificar

| Arquivo | Acao | Descricao |
|---------|------|-----------|
| `src/components/reports/OutdatedReportBanner.tsx` | Criar | Componente de alerta de desatualizacao |
| `src/components/reports/ReportEditorModal.tsx` | Modificar | Integrar banner no modal |
| `src/components/reports/ReportsList.tsx` | Modificar | Adicionar badge de desatualizado na lista |
| `src/components/reports/GenerateReportButton.tsx` | Modificar | Aceitar prop para abrir externamente |

---

## Secao Tecnica

### Hook Customizado: `useReportFreshness`

```typescript
interface ReportFreshnessResult {
  isOutdated: boolean;
  newFilesCount: number;
  newInsightsCount: number;
  isLoading: boolean;
}

function useReportFreshness(
  projectId: string, 
  reportCreatedAt: string
): ReportFreshnessResult
```

### Query de Verificacao

```typescript
const { data: freshness } = useQuery({
  queryKey: ['report-freshness', projectId, reportCreatedAt],
  queryFn: async () => {
    const reportDate = new Date(reportCreatedAt).toISOString();
    
    const [filesResult, insightsResult] = await Promise.all([
      supabase
        .from('project_files')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .gt('created_at', reportDate)
        .is('deleted_at', null),
      supabase
        .from('knowledge_items')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .gt('extracted_at', reportDate)
        .is('deleted_at', null)
    ]);
    
    return {
      newFiles: filesResult.count || 0,
      newInsights: insightsResult.count || 0
    };
  },
  staleTime: 30000 // Cache por 30 segundos
});
```

### Modificacao do GenerateReportButton

Adicionar props para controle externo:
```typescript
interface GenerateReportButtonProps {
  projectId: string;
  onReportGenerated: (reportId: string) => void;
  // Novas props:
  externalOpen?: boolean;
  onExternalOpenChange?: (open: boolean) => void;
  defaultReportType?: 'progress' | 'final' | 'executive';
  triggerButton?: React.ReactNode; // Permite customizar o botao
}
```

### Componente OutdatedReportBanner

```typescript
interface OutdatedReportBannerProps {
  projectId: string;
  reportCreatedAt: string;
  onRegenerateClick: () => void;
}
```

---

## Consideracoes de UX

1. **Nao bloqueia edicao**: O alerta e informativo, usuario pode ignorar
2. **Contexto claro**: Mostra quantos arquivos/insights novos existem
3. **Acao direta**: Botao leva direto ao dialog de geracao
4. **Preserva historico**: Relatorio antigo nunca e apagado automaticamente
5. **Performance**: Query otimizada com `count: 'exact'` e `head: true`

---

## Ordem de Implementacao

1. Criar hook `useReportFreshness`
2. Criar componente `OutdatedReportBanner`
3. Modificar `GenerateReportButton` para aceitar controle externo
4. Integrar banner no `ReportEditorModal`
5. Adicionar badge na `ReportsList`
6. Testar fluxo completo
