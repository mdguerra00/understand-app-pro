
# Plano: Exclusao de Projetos

## Visao Geral

Implementar a funcionalidade de exclusao de projetos (soft delete), permitindo que apenas o proprietario do projeto possa excluir. O botao "Configuracoes" existente sera transformado em um menu/modal com opcoes de gerenciamento do projeto, incluindo a exclusao.

## Infraestrutura Existente

| Elemento | Status | Detalhes |
|----------|--------|----------|
| Campos `deleted_at`/`deleted_by` | Existe | Tabela `projects` ja possui |
| RLS para delete | Existe | `has_project_role(auth.uid(), id, 'owner')` |
| Filtro soft delete | Existe | `Projects.tsx` ja filtra `.is('deleted_at', null)` |
| Padrao de exclusao | Existe | `ReportsList.tsx` e `ProjectFilesList.tsx` usam mesmo padrao |

## Arquitetura da Solucao

```text
ProjectDetail.tsx
    |
    +-- Button "Configuracoes" 
         |
         +-- onClick -> setIsSettingsOpen(true)
                             |
                             v
                   ProjectSettingsModal (NOVO)
                        |
                        +-- Secao "Zona de Perigo"
                        |       |
                        |       +-- Botao "Excluir Projeto"
                        |                |
                        |                v
                        |      AlertDialog (confirmacao)
                        |                |
                        |                +-- Input para digitar nome do projeto
                        |                +-- Botao "Excluir Permanentemente"
                        |
                        +-- (Futuro: Edicao de nome, status, etc.)
```

## Fluxo de Usuario

1. Usuario clica em "Configuracoes" no cabecalho do projeto
2. Modal abre com opcoes de configuracao
3. Na "Zona de Perigo", usuario ve aviso sobre exclusao
4. Usuario clica em "Excluir Projeto"
5. Dialog de confirmacao pede que digite o nome do projeto
6. Apos digitar corretamente, botao de exclusao e habilitado
7. Usuario confirma, projeto e soft-deleted
8. Usuario e redirecionado para `/projects` com toast de sucesso

## Verificacao de Permissao

Apenas o **owner** pode ver o botao de exclusao. Para isso, verificamos o papel do usuario no projeto:

```typescript
// Verificar se usuario e owner
const { data: membership } = await supabase
  .from('project_members')
  .select('role_in_project')
  .eq('project_id', id)
  .eq('user_id', user.id)
  .single();

const isOwner = membership?.role_in_project === 'owner';
```

## Componentes a Criar/Modificar

### 1. Novo: `ProjectSettingsModal.tsx`

Modal com:
- Titulo "Configuracoes do Projeto"
- Secao futura para edicao (placeholders)
- Separador
- "Zona de Perigo" com botao de exclusao vermelho
- AlertDialog aninhado para confirmacao

### 2. Modificar: `ProjectDetail.tsx`

- Adicionar estado `isSettingsOpen`
- Adicionar estado `isOwner` baseado na verificacao de papel
- Conectar botao "Configuracoes" ao modal
- Passar `isOwner` para o modal controlar visibilidade da exclusao

## Secao Tecnica

### ProjectSettingsModal Interface

```typescript
interface ProjectSettingsModalProps {
  projectId: string;
  projectName: string;
  isOwner: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}
```

### Logica de Exclusao

```typescript
const handleDelete = async () => {
  if (confirmName !== projectName) return;
  
  setIsDeleting(true);
  try {
    const { error } = await supabase
      .from('projects')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', projectId);

    if (error) throw error;

    toast({
      title: 'Projeto excluido',
      description: 'O projeto foi movido para a lixeira',
    });

    onDeleted(); // Redireciona para /projects
  } catch (error: any) {
    toast({
      title: 'Erro ao excluir',
      description: error.message,
      variant: 'destructive',
    });
  } finally {
    setIsDeleting(false);
  }
};
```

### Verificacao de Papel no ProjectDetail

```typescript
// Dentro de fetchProject(), apos buscar o projeto:
const { data: membership } = await supabase
  .from('project_members')
  .select('role_in_project')
  .eq('project_id', id)
  .eq('user_id', user?.id)
  .single();

setUserRole(membership?.role_in_project || null);
```

## Layout do Modal

```text
+------------------------------------------+
|  Configuracoes do Projeto          [X]   |
+------------------------------------------+
|                                          |
|  Informacoes do Projeto                  |
|  (Proxima versao: edicao de nome, etc.)  |
|                                          |
|  ----------------------------------------|
|                                          |
|  Zona de Perigo                          |
|  [!] Esta acao nao pode ser desfeita     |
|                                          |
|  [ Excluir Projeto ]  (vermelho)         |
|                                          |
+------------------------------------------+
```

## Dialog de Confirmacao

```text
+------------------------------------------+
|  Excluir Projeto?                        |
+------------------------------------------+
|                                          |
|  Tem certeza que deseja excluir          |
|  "Nome do Projeto"?                      |
|                                          |
|  Esta acao movera o projeto para a       |
|  lixeira. Todos os arquivos, tarefas     |
|  e relatorios serao arquivados.          |
|                                          |
|  Digite o nome do projeto para confirmar:|
|  [ _________________________________ ]   |
|                                          |
|  [Cancelar]     [Excluir Permanentemente]|
|                 (desabilitado ate match) |
+------------------------------------------+
```

## Arquivos a Modificar

| Arquivo | Acao | Descricao |
|---------|------|-----------|
| `src/components/projects/ProjectSettingsModal.tsx` | Criar | Modal de configuracoes com exclusao |
| `src/pages/ProjectDetail.tsx` | Modificar | Integrar modal e verificar papel |

## Ordem de Implementacao

1. Criar `ProjectSettingsModal.tsx` com:
   - UI do modal
   - Zona de perigo com botao de exclusao
   - AlertDialog de confirmacao com input
   - Logica de soft delete

2. Modificar `ProjectDetail.tsx`:
   - Adicionar estado para modal e papel do usuario
   - Buscar papel do usuario ao carregar projeto
   - Conectar botao "Configuracoes" ao modal
   - Implementar redirecionamento apos exclusao

## Consideracoes de Seguranca

- RLS ja existe para permitir apenas owners a fazer UPDATE em `deleted_at`
- Verificacao client-side serve apenas para UX (esconder botao)
- Servidor valida permissao via RLS antes de executar

## Beneficios

1. **Seguranca** - Dupla confirmacao (modal + digitar nome)
2. **Recuperavel** - Soft delete permite restauracao futura
3. **Consistente** - Segue padrao ja usado em Reports e Files
4. **Extensivel** - Modal pronto para receber mais opcoes de configuracao
