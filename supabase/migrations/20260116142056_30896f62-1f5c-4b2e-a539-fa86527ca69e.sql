-- =============================================
-- SMART DENT MANAGER 2.2 - FASE 1: FUNDAÇÃO
-- =============================================

-- 1. ENUM TYPES
-- =============================================

-- Roles globais do sistema
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Roles dentro de um projeto
CREATE TYPE public.project_role AS ENUM ('owner', 'manager', 'researcher', 'viewer');

-- Status de projetos
CREATE TYPE public.project_status AS ENUM ('planning', 'in_progress', 'review', 'completed', 'archived');

-- Status de tarefas
CREATE TYPE public.task_status AS ENUM ('todo', 'in_progress', 'review', 'done');

-- Prioridade de tarefas
CREATE TYPE public.task_priority AS ENUM ('low', 'medium', 'high', 'urgent');

-- Status de relatórios
CREATE TYPE public.report_status AS ENUM ('draft', 'submitted', 'under_review', 'approved', 'archived');

-- =============================================
-- 2. PROFILES TABLE
-- =============================================

CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    job_title TEXT,
    department TEXT,
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS: Usuários podem ver todos os perfis, mas só editar o próprio
CREATE POLICY "Anyone can view profiles" 
ON public.profiles FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can update own profile" 
ON public.profiles FOR UPDATE 
TO authenticated 
USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
ON public.profiles FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = id);

-- =============================================
-- 3. USER ROLES TABLE (roles globais)
-- =============================================

CREATE TABLE public.user_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role app_role NOT NULL DEFAULT 'user',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function para checar role global
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.user_roles
        WHERE user_id = _user_id AND role = _role
    )
$$;

-- RLS: Apenas admins podem ver todas as roles
CREATE POLICY "Admins can view all roles" 
ON public.user_roles FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

CREATE POLICY "Admins can manage roles" 
ON public.user_roles FOR ALL 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- 4. PROJECTS TABLE
-- =============================================

CREATE TABLE public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    objectives TEXT,
    category TEXT,
    status project_status NOT NULL DEFAULT 'planning',
    start_date DATE,
    end_date DATE,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- =============================================
-- 5. PROJECT MEMBERS TABLE (RBAC por projeto)
-- =============================================

CREATE TABLE public.project_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_in_project project_role NOT NULL DEFAULT 'viewer',
    invited_by UUID REFERENCES auth.users(id),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, user_id)
);

ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;

-- Security definer function para checar membership em projeto
CREATE OR REPLACE FUNCTION public.is_project_member(_user_id UUID, _project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_members
        WHERE user_id = _user_id AND project_id = _project_id
    )
$$;

-- Security definer function para checar role em projeto específico
CREATE OR REPLACE FUNCTION public.get_project_role(_user_id UUID, _project_id UUID)
RETURNS project_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role_in_project FROM public.project_members
    WHERE user_id = _user_id AND project_id = _project_id
    LIMIT 1
$$;

-- Security definer function para checar se tem role mínima em projeto
CREATE OR REPLACE FUNCTION public.has_project_role(_user_id UUID, _project_id UUID, _min_role project_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.project_members pm
        WHERE pm.user_id = _user_id 
        AND pm.project_id = _project_id
        AND (
            pm.role_in_project = 'owner' OR
            (_min_role = 'manager' AND pm.role_in_project IN ('owner', 'manager')) OR
            (_min_role = 'researcher' AND pm.role_in_project IN ('owner', 'manager', 'researcher')) OR
            (_min_role = 'viewer')
        )
    )
$$;

-- RLS: Projetos visíveis apenas para membros (soft delete respeitado)
CREATE POLICY "Members can view their projects" 
ON public.projects FOR SELECT 
TO authenticated 
USING (
    deleted_at IS NULL 
    AND public.is_project_member(auth.uid(), id)
);

-- Admins podem ver projetos deletados
CREATE POLICY "Admins can view all projects including deleted" 
ON public.projects FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

-- Qualquer usuário autenticado pode criar projeto
CREATE POLICY "Authenticated users can create projects" 
ON public.projects FOR INSERT 
TO authenticated 
WITH CHECK (auth.uid() = created_by);

-- Owners e managers podem atualizar projeto
CREATE POLICY "Owners and managers can update projects" 
ON public.projects FOR UPDATE 
TO authenticated 
USING (public.has_project_role(auth.uid(), id, 'manager'));

-- Apenas owners podem deletar (soft delete)
CREATE POLICY "Owners can delete projects" 
ON public.projects FOR DELETE 
TO authenticated 
USING (public.has_project_role(auth.uid(), id, 'owner'));

-- RLS para project_members
CREATE POLICY "Members can view project members" 
ON public.project_members FOR SELECT 
TO authenticated 
USING (public.is_project_member(auth.uid(), project_id));

CREATE POLICY "Managers can add members" 
ON public.project_members FOR INSERT 
TO authenticated 
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can update members" 
ON public.project_members FOR UPDATE 
TO authenticated 
USING (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can remove members" 
ON public.project_members FOR DELETE 
TO authenticated 
USING (public.has_project_role(auth.uid(), project_id, 'manager'));

-- =============================================
-- 6. PROJECT INVITES TABLE (convites seguros)
-- =============================================

CREATE TABLE public.project_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role_in_project project_role NOT NULL DEFAULT 'viewer',
    token_hash TEXT NOT NULL,
    invited_by UUID NOT NULL REFERENCES auth.users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.project_invites ENABLE ROW LEVEL SECURITY;

-- RLS: Managers podem ver e criar convites
CREATE POLICY "Managers can view invites" 
ON public.project_invites FOR SELECT 
TO authenticated 
USING (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can create invites" 
ON public.project_invites FOR INSERT 
TO authenticated 
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'manager'));

CREATE POLICY "Managers can delete invites" 
ON public.project_invites FOR DELETE 
TO authenticated 
USING (public.has_project_role(auth.uid(), project_id, 'manager'));

-- =============================================
-- 7. TASKS TABLE
-- =============================================

CREATE TABLE public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    status task_status NOT NULL DEFAULT 'todo',
    priority task_priority NOT NULL DEFAULT 'medium',
    assigned_to UUID REFERENCES auth.users(id),
    due_date DATE,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID REFERENCES auth.users(id)
);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

-- RLS: Membros do projeto podem ver e gerenciar tarefas
CREATE POLICY "Members can view tasks" 
ON public.tasks FOR SELECT 
TO authenticated 
USING (
    deleted_at IS NULL 
    AND public.is_project_member(auth.uid(), project_id)
);

CREATE POLICY "Researchers can create tasks" 
ON public.tasks FOR INSERT 
TO authenticated 
WITH CHECK (public.has_project_role(auth.uid(), project_id, 'researcher'));

CREATE POLICY "Researchers can update tasks" 
ON public.tasks FOR UPDATE 
TO authenticated 
USING (public.has_project_role(auth.uid(), project_id, 'researcher'));

CREATE POLICY "Managers can delete tasks" 
ON public.tasks FOR DELETE 
TO authenticated 
USING (public.has_project_role(auth.uid(), project_id, 'manager'));

-- =============================================
-- 8. TASK COMMENTS TABLE
-- =============================================

CREATE TABLE public.task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

-- RLS: Membros podem ver e criar comentários
CREATE POLICY "Members can view comments" 
ON public.task_comments FOR SELECT 
TO authenticated 
USING (
    EXISTS (
        SELECT 1 FROM public.tasks t 
        WHERE t.id = task_id 
        AND public.is_project_member(auth.uid(), t.project_id)
    )
);

CREATE POLICY "Members can create comments" 
ON public.task_comments FOR INSERT 
TO authenticated 
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.tasks t 
        WHERE t.id = task_id 
        AND public.is_project_member(auth.uid(), t.project_id)
    ) AND auth.uid() = created_by
);

CREATE POLICY "Authors can update own comments" 
ON public.task_comments FOR UPDATE 
TO authenticated 
USING (auth.uid() = created_by);

CREATE POLICY "Authors can delete own comments" 
ON public.task_comments FOR DELETE 
TO authenticated 
USING (auth.uid() = created_by);

-- =============================================
-- 9. AUDIT LOG TABLE
-- =============================================

CREATE TABLE public.audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    action TEXT NOT NULL,
    old_data JSONB,
    new_data JSONB,
    changed_fields TEXT[],
    user_id UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- RLS: Apenas admins podem ver logs
CREATE POLICY "Admins can view audit logs" 
ON public.audit_log FOR SELECT 
TO authenticated 
USING (public.has_role(auth.uid(), 'admin'));

-- =============================================
-- 10. TRIGGERS E FUNCTIONS
-- =============================================

-- Function para atualizar updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Triggers para updated_at
CREATE TRIGGER update_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
    BEFORE UPDATE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at
    BEFORE UPDATE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_task_comments_updated_at
    BEFORE UPDATE ON public.task_comments
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Function para criar profile automaticamente no signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (
        NEW.id, 
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
    );
    
    -- Dar role 'user' por padrão
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'user');
    
    RETURN NEW;
END;
$$;

-- Trigger para criar profile no signup
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function para adicionar criador como owner do projeto
CREATE OR REPLACE FUNCTION public.add_project_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.project_members (project_id, user_id, role_in_project, invited_by)
    VALUES (NEW.id, NEW.created_by, 'owner', NEW.created_by);
    RETURN NEW;
END;
$$;

-- Trigger para adicionar owner ao criar projeto
CREATE TRIGGER on_project_created
    AFTER INSERT ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.add_project_owner();

-- Function para auditoria genérica
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    changed TEXT[];
    col TEXT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_log (table_name, record_id, action, old_data, user_id)
        VALUES (TG_TABLE_NAME, OLD.id, 'DELETE', to_jsonb(OLD), auth.uid());
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Detectar campos alterados
        changed := ARRAY[]::TEXT[];
        FOR col IN SELECT column_name FROM information_schema.columns 
                   WHERE table_name = TG_TABLE_NAME AND table_schema = 'public'
        LOOP
            IF to_jsonb(NEW) -> col IS DISTINCT FROM to_jsonb(OLD) -> col THEN
                changed := changed || col;
            END IF;
        END LOOP;
        
        INSERT INTO public.audit_log (table_name, record_id, action, old_data, new_data, changed_fields, user_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), changed, auth.uid());
        RETURN NEW;
    ELSIF TG_OP = 'INSERT' THEN
        INSERT INTO public.audit_log (table_name, record_id, action, new_data, user_id)
        VALUES (TG_TABLE_NAME, NEW.id, 'INSERT', to_jsonb(NEW), auth.uid());
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

-- Triggers de auditoria para tabelas principais
CREATE TRIGGER audit_projects
    AFTER INSERT OR UPDATE OR DELETE ON public.projects
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_tasks
    AFTER INSERT OR UPDATE OR DELETE ON public.tasks
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_project_members
    AFTER INSERT OR UPDATE OR DELETE ON public.project_members
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();