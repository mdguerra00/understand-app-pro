# Validação Técnica — Segurança do Sistema de Usuários

## 1) Policies RLS (SQL real)

As policies abaixo são as vigentes após a migration `20260219143000_harden_user_security.sql`.

### `profiles`
```sql
CREATE POLICY "Users can view own and project peer profiles"
ON public.profiles FOR SELECT TO authenticated
USING (
  id = auth.uid()
  OR public.has_role(auth.uid(), 'admin')
  OR EXISTS (
    SELECT 1
    FROM public.project_members pm_self
    JOIN public.project_members pm_peer ON pm_peer.project_id = pm_self.project_id
    WHERE pm_self.user_id = auth.uid()
      AND pm_peer.user_id = profiles.id
  )
);

CREATE POLICY "Users can insert own profile"
ON public.profiles FOR INSERT TO authenticated
WITH CHECK (id = auth.uid());

CREATE POLICY "Users can update own non-status profile"
ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid())
WITH CHECK (
  id = auth.uid()
  AND status = (
    SELECT p.status
    FROM public.profiles p
    WHERE p.id = auth.uid()
  )
);

CREATE POLICY "Admins can update any profile"
ON public.profiles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
```

### `user_roles`
```sql
CREATE POLICY "Admins can view all roles and users can view own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

CREATE POLICY "Admins can insert roles"
ON public.user_roles FOR INSERT TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
ON public.user_roles FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
ON public.user_roles FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
```

### `projects`
```sql
CREATE POLICY "Members can view their projects"
ON public.projects FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_project_member(auth.uid(), id));

CREATE POLICY "Admins can view all projects including deleted"
ON public.projects FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated users can create projects"
ON public.projects FOR INSERT TO authenticated
WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Owners and managers can update projects"
ON public.projects FOR UPDATE TO authenticated
USING (public.has_project_role(auth.uid(), id, 'manager'))
WITH CHECK (public.has_project_role(auth.uid(), id, 'manager'));

CREATE POLICY "Owners can delete projects"
ON public.projects FOR DELETE TO authenticated
USING (public.has_project_role(auth.uid(), id, 'owner'));
```

### `project_members`
```sql
CREATE POLICY "Members can view project members"
ON public.project_members FOR SELECT TO authenticated
USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "Managers can add members"
ON public.project_members FOR INSERT TO authenticated
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can update members"
ON public.project_members FOR UPDATE TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'manager'))
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can remove members"
ON public.project_members FOR DELETE TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'manager'));
```

### `tasks`
```sql
CREATE POLICY "Members can view tasks"
ON public.tasks FOR SELECT TO authenticated
USING (deleted_at IS NULL AND public.is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can create tasks"
ON public.tasks FOR INSERT TO authenticated
WITH CHECK (
  public.has_project_role(auth.uid(), project_id, 'researcher')
  AND (assigned_to IS NULL OR public.is_project_member(assigned_to, project_id))
);

CREATE POLICY "Researchers can update tasks"
ON public.tasks FOR UPDATE TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'researcher'))
WITH CHECK (
  public.has_project_role(auth.uid(), project_id, 'researcher')
  AND (assigned_to IS NULL OR public.is_project_member(assigned_to, project_id))
);

CREATE POLICY "Managers can delete tasks"
ON public.tasks FOR DELETE TO authenticated
USING (public.has_project_role(auth.uid(), project_id, 'manager'));
```

## 2) Matriz de permissões (resumo operacional)

| Recurso | Usuário comum | Manager/Owner do projeto | Admin global |
|---|---|---|---|
| Ver `user_roles` de terceiros | Não | Não | Sim |
| Inserir `user_roles` | Não | Não | Sim |
| Alterar `profiles.status` de terceiros | Não | Não | Sim |
| Ver `profiles` | Próprio + pares em mesmo projeto | Próprio + pares em mesmo projeto | Todos |
| Inserir em `project_members` | Não | Sim (somente no projeto em que é manager/owner) | Sim (se também tiver papel no projeto) |
| Listar `tasks` | Somente tarefas de projetos onde é membro (RLS) | Idem | Todas (se membro/admin via policies de projeto) |
| Criar/editar `tasks` com assignee fora do projeto | Não (bloqueado por policy + trigger) | Não | Não |

## 3) Testes de segurança (SQL reproduzível)

> Rode em sessão autenticada como usuário comum (JWT de usuário sem admin global).

### Teste A — não pode promover a si próprio para admin
```sql
INSERT INTO public.user_roles (user_id, role)
VALUES (auth.uid(), 'admin');
```
**Resultado esperado:** erro de RLS (violação de policy `Admins can insert roles`).

### Teste B — não pode alterar status de outro usuário
```sql
UPDATE public.profiles
SET status = 'disabled'
WHERE id = '<uuid_de_outro_usuario>';
```
**Resultado esperado:** `UPDATE 0` (sem linhas visíveis/alteráveis por RLS) ou erro de policy.

### Teste C — não pode adicionar membro em projeto sem role de manager/owner
```sql
INSERT INTO public.project_members (project_id, user_id, role_in_project, invited_by)
VALUES ('<uuid_projeto_sem_permissao>', '<uuid_usuario_alvo>', 'viewer', auth.uid());
```
**Resultado esperado:** erro de RLS (policy `Managers can add members`).

## 4) Regras de tarefas exigidas

- Listagem de tarefas do módulo **Tarefas**: filtro obrigatório por `assigned_to = auth user` no frontend.
- Escopo de projeto: preservado por RLS de `tasks` (`is_project_member(auth.uid(), project_id)`).
- Dropdown de responsável: alimentado somente por `project_members` do projeto.
- Validação backend para assignee fora do projeto:
  - trigger `validate_task_assignee`;
  - `WITH CHECK` adicional nas policies de `INSERT/UPDATE` em `tasks`.

## 5) Mudança de requisito: criação de usuário somente admin

- A tela de `Auth` não possui mais aba/formulário de cadastro público.
- Criação de usuário ocorre apenas pela função `create-user` (edge function), com verificação explícita de role `admin` do chamador.
- `CreateUserModal` não adiciona mais usuário automaticamente em todos os projetos.
