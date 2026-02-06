

# Plano: Adicionar Edição Completa de Campos

## Resumo

Implementar edição inline e via modal para campos que atualmente nao podem ser editados: informacoes do projeto e comentarios de tarefas.

## Mudancas Planejadas

### 1. Editar Informacoes do Projeto (ProjectSettingsModal)

**Arquivo:** `src/components/projects/ProjectSettingsModal.tsx`

Substituir o placeholder "estara disponivel em breve" por um formulario completo com:
- Nome do projeto (input text, obrigatorio)
- Descricao (textarea)
- Objetivos (textarea)
- Categoria (input text)
- Status (select: planning, in_progress, review, completed, archived)
- Data de inicio (input date)
- Data de termino (input date)

O formulario usara react-hook-form + zod para validacao e chamara `supabase.from('projects').update(...)`. Apos salvar, disparara callback `onUpdated` para atualizar a pagina.

**Props adicionais necessarias:** adicionar `onUpdated` callback e passar os dados do projeto completo (ou buscar dentro do modal).

**Arquivo:** `src/pages/ProjectDetail.tsx`
- Passar dados do projeto para o modal de configuracoes
- Adicionar callback `onUpdated` que re-busca os dados do projeto

### 2. Editar Comentarios de Tarefas

**Arquivo:** `src/components/tasks/TaskComments.tsx`

Adicionar funcionalidade de edicao inline nos comentarios do usuario:
- Ao clicar no icone de editar (visivel no hover, ao lado do botao de excluir), o texto do comentario sera substituido por um textarea editavel
- Botoes "Salvar" e "Cancelar" aparecerao abaixo
- Chamara `supabase.from('task_comments').update({ content }).eq('id', commentId)` 
- RLS ja permite: "Authors can update own comments" existe na tabela task_comments

### Detalhes Tecnicos

| Arquivo | Tipo de Mudanca |
|---------|----------------|
| `src/components/projects/ProjectSettingsModal.tsx` | Adicionar formulario de edicao completo |
| `src/pages/ProjectDetail.tsx` | Passar props do projeto e callback onUpdated |
| `src/components/tasks/TaskComments.tsx` | Adicionar edicao inline de comentarios |

### Seguranca

- Projetos: RLS "Owners and managers can update projects" ja cobre a atualizacao
- Comentarios: RLS "Authors can update own comments" ja cobre a atualizacao
- Validacao client-side com zod para limites de caracteres

### Nao necessario (ja funciona)

- Edicao de tarefas (TaskEditModal ja cobre todos os campos)
- Edicao de relatorios (ReportEditorModal ja cobre titulo, resumo, conteudo, status)
- Edicao de datas de tarefas (ja no TaskEditModal)

