
# Plano: Painel de Administracao Master

## Resumo

Criar uma area administrativa acessivel apenas para usuarios com role `admin` (sua conta ja possui essa role). O painel permitira gerenciar usuarios do sistema, atribuir roles globais e ver a atividade geral.

## Sua Conta

Sua conta (mdguerra@smartdent.com.br) ja possui a role `admin` no banco de dados. Nenhuma mudanca de banco necessaria para isso.

## Matriz de Permissoes

### Roles Globais (tabela `user_roles`)

| Acao | Admin | User |
|------|-------|------|
| Acessar painel admin | Sim | Nao |
| Ver lista de todos os usuarios | Sim | Nao |
| Alterar role global de usuario | Sim | Nao |
| Desativar/reativar usuario | Sim | Nao |
| Ver log de auditoria | Sim | Nao |
| Criar projetos | Sim | Sim |
| Acessar configuracoes pessoais | Sim | Sim |

### Roles de Projeto (tabela `project_members`) - ja implementadas

| Acao | Owner | Manager | Researcher | Viewer |
|------|-------|---------|------------|--------|
| Editar projeto | Sim | Sim | Nao | Nao |
| Excluir projeto | Sim | Nao | Nao | Nao |
| Convidar membros | Sim | Sim | Nao | Nao |
| Criar tarefas | Sim | Sim | Sim | Nao |
| Editar tarefas | Sim | Sim | Sim | Nao |
| Excluir tarefas | Sim | Sim | Nao | Nao |
| Upload de arquivos | Sim | Sim | Sim | Nao |
| Excluir arquivos | Sim | Sim | Nao | Nao |
| Criar relatorios | Sim | Sim | Sim | Nao |
| Aprovar relatorios | Sim | Sim | Nao | Nao |
| Visualizar conteudo | Sim | Sim | Sim | Sim |

## Mudancas Planejadas

### 1. Novo Hook: `src/hooks/useAdminRole.ts`

Hook simples que consulta `user_roles` para verificar se o usuario logado tem role `admin`. Retorna `{ isAdmin, loading }`.

### 2. Nova Pagina: `src/pages/Admin.tsx`

Painel com abas:
- **Usuarios**: lista todos os perfis com email, nome, role global, data de criacao. Permite alterar a role (admin/user).
- **Auditoria**: exibe os ultimos registros da tabela `audit_log` (acoes recentes no sistema).

### 3. Sidebar: `src/components/layout/AppSidebar.tsx`

Adicionar item "Administracao" no menu (visivel apenas para admins), com icone `Shield`.

### 4. Rota: `src/App.tsx`

Adicionar rota `/admin` protegida pelo AppLayout. A pagina Admin internamente verificara se o usuario e admin e mostrara "acesso negado" caso contrario.

### 5. Funcionalidade de Gerenciamento de Usuarios

Na aba "Usuarios" do painel admin:
- Tabela com colunas: Nome, Email, Role Global, Data de Cadastro
- Botao para alterar role entre `admin` e `user` (dropdown)
- As RLS policies de `user_roles` ja permitem que admins gerenciem roles (`Admins can manage roles`)

## Detalhes Tecnicos

| Arquivo | Mudanca |
|---------|---------|
| `src/hooks/useAdminRole.ts` | Novo - verifica se usuario e admin |
| `src/pages/Admin.tsx` | Novo - painel com abas Usuarios e Auditoria |
| `src/components/layout/AppSidebar.tsx` | Adicionar link condicional "Administracao" |
| `src/App.tsx` | Adicionar rota `/admin` |

### Seguranca

- RLS de `user_roles`: policy `Admins can manage roles` ja cobre INSERT/UPDATE/DELETE para admins
- RLS de `audit_log`: policy `Admins can view audit logs` ja cobre SELECT para admins
- RLS de `profiles`: policy `Anyone can view profiles` ja permite listar usuarios
- Verificacao dupla: no frontend (hook `useAdminRole`) e no backend (RLS policies)
- Nenhuma migracao de banco de dados necessaria

### Fluxo

1. Admin acessa `/admin` via sidebar
2. Ve lista de todos os usuarios com suas roles
3. Pode alterar a role de qualquer usuario (admin/user)
4. Pode ver log de auditoria com acoes recentes
5. Usuarios sem role admin veem "Acesso negado" se tentarem acessar a URL diretamente
