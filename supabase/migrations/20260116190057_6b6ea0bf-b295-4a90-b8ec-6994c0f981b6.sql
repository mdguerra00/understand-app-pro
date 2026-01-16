-- ================================================
-- FASE 3: Sistema de Arquivos com Versionamento
-- ================================================

-- 1. Criar bucket de storage para arquivos de projetos
INSERT INTO storage.buckets (id, name, public)
VALUES ('project-files', 'project-files', false);

-- 2. Tabela principal de arquivos (metadados)
CREATE TABLE public.project_files (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    storage_path TEXT NOT NULL,
    mime_type TEXT,
    size_bytes BIGINT,
    current_version INTEGER NOT NULL DEFAULT 1,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    deleted_at TIMESTAMPTZ,
    deleted_by UUID,
    
    CONSTRAINT unique_file_path UNIQUE (project_id, storage_path)
);

-- 3. Tabela de versões de arquivos
CREATE TABLE public.project_file_versions (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    file_id UUID NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
    version_number INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes BIGINT,
    upload_comment TEXT,
    uploaded_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT unique_file_version UNIQUE (file_id, version_number)
);

-- 4. Índices para performance
CREATE INDEX idx_project_files_project_id ON public.project_files(project_id);
CREATE INDEX idx_project_files_deleted_at ON public.project_files(deleted_at);
CREATE INDEX idx_project_file_versions_file_id ON public.project_file_versions(file_id);

-- ================================================
-- RLS para project_files
-- ================================================
ALTER TABLE public.project_files ENABLE ROW LEVEL SECURITY;

-- SELECT: Membros podem ver arquivos do projeto (exceto deletados)
CREATE POLICY "Members can view project files"
    ON public.project_files FOR SELECT
    TO authenticated
    USING (
        deleted_at IS NULL 
        AND is_project_member(auth.uid(), project_id)
    );

-- SELECT: Admins podem ver todos incluindo deletados (para restore)
CREATE POLICY "Admins can view all files including deleted"
    ON public.project_files FOR SELECT
    TO authenticated
    USING (
        has_role(auth.uid(), 'admin'::app_role)
    );

-- INSERT: Researchers+ podem fazer upload
CREATE POLICY "Researchers can upload files"
    ON public.project_files FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = uploaded_by
        AND has_project_role(auth.uid(), project_id, 'researcher'::project_role)
    );

-- UPDATE: Researchers+ podem atualizar metadados
CREATE POLICY "Researchers can update file metadata"
    ON public.project_files FOR UPDATE
    TO authenticated
    USING (
        has_project_role(auth.uid(), project_id, 'researcher'::project_role)
    );

-- DELETE: Managers+ podem deletar (soft delete via UPDATE)
CREATE POLICY "Managers can delete files"
    ON public.project_files FOR DELETE
    TO authenticated
    USING (
        has_project_role(auth.uid(), project_id, 'manager'::project_role)
    );

-- ================================================
-- RLS para project_file_versions
-- ================================================
ALTER TABLE public.project_file_versions ENABLE ROW LEVEL SECURITY;

-- SELECT: Membros podem ver versões dos arquivos do projeto
CREATE POLICY "Members can view file versions"
    ON public.project_file_versions FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.project_files pf
            WHERE pf.id = project_file_versions.file_id
            AND pf.deleted_at IS NULL
            AND is_project_member(auth.uid(), pf.project_id)
        )
    );

-- INSERT: Researchers+ podem criar novas versões
CREATE POLICY "Researchers can create file versions"
    ON public.project_file_versions FOR INSERT
    TO authenticated
    WITH CHECK (
        auth.uid() = uploaded_by
        AND EXISTS (
            SELECT 1 FROM public.project_files pf
            WHERE pf.id = project_file_versions.file_id
            AND has_project_role(auth.uid(), pf.project_id, 'researcher'::project_role)
        )
    );

-- ================================================
-- Storage Policies para bucket project-files
-- ================================================

-- SELECT: Membros podem baixar arquivos do projeto
CREATE POLICY "Project members can download files"
    ON storage.objects FOR SELECT
    TO authenticated
    USING (
        bucket_id = 'project-files'
        AND is_project_member(auth.uid(), (storage.foldername(name))[1]::uuid)
    );

-- INSERT: Researchers+ podem fazer upload
CREATE POLICY "Researchers can upload to project bucket"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (
        bucket_id = 'project-files'
        AND has_project_role(auth.uid(), (storage.foldername(name))[1]::uuid, 'researcher'::project_role)
    );

-- UPDATE: Researchers+ podem atualizar arquivos
CREATE POLICY "Researchers can update project files"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (
        bucket_id = 'project-files'
        AND has_project_role(auth.uid(), (storage.foldername(name))[1]::uuid, 'researcher'::project_role)
    );

-- DELETE: Managers+ podem deletar do storage
CREATE POLICY "Managers can delete from project bucket"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (
        bucket_id = 'project-files'
        AND has_project_role(auth.uid(), (storage.foldername(name))[1]::uuid, 'manager'::project_role)
    );

-- ================================================
-- Triggers para updated_at
-- ================================================
CREATE TRIGGER update_project_files_updated_at
    BEFORE UPDATE ON public.project_files
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ================================================
-- Trigger para incrementar version automaticamente
-- ================================================
CREATE OR REPLACE FUNCTION public.increment_file_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Atualiza a versão atual do arquivo
    UPDATE public.project_files
    SET current_version = NEW.version_number,
        updated_at = now()
    WHERE id = NEW.file_id;
    
    RETURN NEW;
END;
$$;

CREATE TRIGGER after_file_version_insert
    AFTER INSERT ON public.project_file_versions
    FOR EACH ROW
    EXECUTE FUNCTION public.increment_file_version();

-- ================================================
-- Função para buscar arquivos incluindo na busca global
-- ================================================
CREATE OR REPLACE FUNCTION public.global_search(search_query text)
RETURNS TABLE(
    result_type text, 
    result_id uuid, 
    title text, 
    subtitle text, 
    project_id uuid, 
    project_name text, 
    relevance real
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    -- Search Projects
    SELECT 
        'project'::TEXT as result_type,
        p.id as result_id,
        p.name as title,
        p.description as subtitle,
        p.id as project_id,
        p.name as project_name,
        CASE 
            WHEN p.name ILIKE '%' || search_query || '%' THEN 1.0
            WHEN p.description ILIKE '%' || search_query || '%' THEN 0.7
            ELSE 0.5
        END::REAL as relevance
    FROM public.projects p
    WHERE p.deleted_at IS NULL
      AND is_project_member(auth.uid(), p.id)
      AND (
          p.name ILIKE '%' || search_query || '%'
          OR p.description ILIKE '%' || search_query || '%'
          OR p.objectives ILIKE '%' || search_query || '%'
      )
    
    UNION ALL
    
    -- Search Tasks
    SELECT 
        'task'::TEXT as result_type,
        t.id as result_id,
        t.title as title,
        t.description as subtitle,
        t.project_id as project_id,
        proj.name as project_name,
        CASE 
            WHEN t.title ILIKE '%' || search_query || '%' THEN 1.0
            WHEN t.description ILIKE '%' || search_query || '%' THEN 0.7
            ELSE 0.5
        END::REAL as relevance
    FROM public.tasks t
    JOIN public.projects proj ON proj.id = t.project_id
    WHERE t.deleted_at IS NULL
      AND is_project_member(auth.uid(), t.project_id)
      AND (
          t.title ILIKE '%' || search_query || '%'
          OR t.description ILIKE '%' || search_query || '%'
      )
    
    UNION ALL
    
    -- Search Files
    SELECT 
        'file'::TEXT as result_type,
        f.id as result_id,
        f.name as title,
        f.description as subtitle,
        f.project_id as project_id,
        proj.name as project_name,
        CASE 
            WHEN f.name ILIKE '%' || search_query || '%' THEN 1.0
            WHEN f.description ILIKE '%' || search_query || '%' THEN 0.7
            ELSE 0.5
        END::REAL as relevance
    FROM public.project_files f
    JOIN public.projects proj ON proj.id = f.project_id
    WHERE f.deleted_at IS NULL
      AND is_project_member(auth.uid(), f.project_id)
      AND (
          f.name ILIKE '%' || search_query || '%'
          OR f.description ILIKE '%' || search_query || '%'
      )
    
    ORDER BY relevance DESC, title
    LIMIT 50;
END;
$$;

-- ================================================
-- Adicionar triggers de auditoria para as novas tabelas
-- ================================================
CREATE TRIGGER audit_project_files
    AFTER INSERT OR UPDATE OR DELETE ON public.project_files
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_project_file_versions
    AFTER INSERT OR UPDATE OR DELETE ON public.project_file_versions
    FOR EACH ROW
    EXECUTE FUNCTION public.audit_trigger_function();