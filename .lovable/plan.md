
# Plano: Adicionar Edição e Exclusão de Tarefas na Página do Projeto

## Resumo

A página de detalhe do projeto (`ProjectDetail.tsx`) permite visualizar tarefas e abrir o modal de detalhes, mas não oferece as opções de **editar** e **excluir** que já existem na página `/tasks`. O objetivo é reutilizar o `TaskEditModal` existente e adicionar um menu de ações (editar/excluir) nos cards de tarefa dentro do projeto.

## Mudanças

### Arquivo: `src/pages/ProjectDetail.tsx`

1. Importar `TaskEditModal` e componentes necessários (`DropdownMenu`, `AlertDialog`, `MoreHorizontal`, `Pencil`, `Trash2`)
2. Adicionar estados: `editTask`, `editOpen`, `deleteTask`, `deleteOpen`, `deleting`
3. Adicionar um botão de menu (três pontos) em cada card de tarefa com opções "Editar" e "Excluir"
4. Adicionar o `TaskEditModal` nos modais do final da página
5. Adicionar o `AlertDialog` de confirmação de exclusão (soft-delete com `deleted_at`/`deleted_by`)
6. Reutilizar a mesma lógica de exclusão da página `/tasks` (soft-delete)

### Resultado Visual

Cada card de tarefa na aba "Tarefas" do projeto terá um menu de três pontos no lado direito com:
- **Editar**: abre o `TaskEditModal` com todos os campos (título, descrição, status, prioridade, responsável, data)
- **Excluir**: abre diálogo de confirmação e faz soft-delete

### Detalhes Técnicos

- Nenhuma mudança de banco de dados necessária
- RLS já cobre: "Researchers can update tasks" e "Managers can delete tasks"
- O `TaskEditModal` já existe e funciona corretamente
- Apenas `src/pages/ProjectDetail.tsx` precisa ser alterado
