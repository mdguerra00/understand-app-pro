-- Phase 5: Knowledge Base Tables

-- Create extraction job status enum
CREATE TYPE extraction_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Create knowledge item category enum  
CREATE TYPE knowledge_category AS ENUM ('compound', 'parameter', 'result', 'method', 'observation');

-- Table: extraction_jobs - Tracks file processing for AI extraction
CREATE TABLE public.extraction_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES project_files(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status extraction_status NOT NULL DEFAULT 'pending',
  file_hash TEXT NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  items_extracted INTEGER DEFAULT 0,
  tokens_used INTEGER DEFAULT 0,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(file_id, file_hash)
);

-- Table: knowledge_items - Stores extracted insights
CREATE TABLE public.knowledge_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_file_id UUID REFERENCES project_files(id) ON DELETE SET NULL,
  extraction_job_id UUID REFERENCES extraction_jobs(id) ON DELETE SET NULL,
  category knowledge_category NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  evidence TEXT,
  evidence_page INTEGER,
  confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  extracted_by UUID NOT NULL,
  validated_by UUID,
  validated_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID
);

-- Enable RLS
ALTER TABLE public.extraction_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.knowledge_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for extraction_jobs
CREATE POLICY "Members can view extraction jobs"
ON public.extraction_jobs FOR SELECT
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can create extraction jobs"
ON public.extraction_jobs FOR INSERT
WITH CHECK (
  auth.uid() = created_by 
  AND has_project_role(auth.uid(), project_id, 'researcher'::project_role)
);

CREATE POLICY "System can update extraction jobs"
ON public.extraction_jobs FOR UPDATE
USING (
  has_project_role(auth.uid(), project_id, 'researcher'::project_role)
  OR created_by = auth.uid()
);

-- RLS Policies for knowledge_items
CREATE POLICY "Members can view knowledge items"
ON public.knowledge_items FOR SELECT
USING (
  deleted_at IS NULL 
  AND is_project_member(auth.uid(), project_id)
);

CREATE POLICY "Admins can view all knowledge items"
ON public.knowledge_items FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Researchers can create knowledge items"
ON public.knowledge_items FOR INSERT
WITH CHECK (
  auth.uid() = extracted_by 
  AND has_project_role(auth.uid(), project_id, 'researcher'::project_role)
);

CREATE POLICY "Researchers can update knowledge items"
ON public.knowledge_items FOR UPDATE
USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Managers can delete knowledge items"
ON public.knowledge_items FOR DELETE
USING (has_project_role(auth.uid(), project_id, 'manager'::project_role));

-- Indexes for performance
CREATE INDEX idx_extraction_jobs_file_id ON public.extraction_jobs(file_id);
CREATE INDEX idx_extraction_jobs_status ON public.extraction_jobs(status);
CREATE INDEX idx_extraction_jobs_project_id ON public.extraction_jobs(project_id);

CREATE INDEX idx_knowledge_items_project_id ON public.knowledge_items(project_id);
CREATE INDEX idx_knowledge_items_category ON public.knowledge_items(category);
CREATE INDEX idx_knowledge_items_source_file ON public.knowledge_items(source_file_id);
CREATE INDEX idx_knowledge_items_search ON public.knowledge_items USING gin(to_tsvector('portuguese', title || ' ' || content));

-- Add audit triggers for knowledge_items
CREATE TRIGGER audit_knowledge_items
AFTER INSERT OR UPDATE OR DELETE ON public.knowledge_items
FOR EACH ROW EXECUTE FUNCTION audit_trigger_function();

-- Update global_search function to include knowledge items
CREATE OR REPLACE FUNCTION global_search(search_query TEXT, p_user_id UUID)
RETURNS TABLE(
  type TEXT,
  id UUID,
  title TEXT,
  subtitle TEXT,
  project_id UUID,
  project_name TEXT,
  relevance REAL
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  -- Projects
  SELECT 
    'project'::TEXT,
    p.id,
    p.name,
    p.description,
    p.id,
    p.name,
    ts_rank(to_tsvector('portuguese', p.name || ' ' || COALESCE(p.description, '')), plainto_tsquery('portuguese', search_query)) AS relevance
  FROM projects p
  WHERE p.deleted_at IS NULL
    AND is_project_member(p_user_id, p.id)
    AND (
      p.name ILIKE '%' || search_query || '%'
      OR p.description ILIKE '%' || search_query || '%'
    )
  
  UNION ALL
  
  -- Tasks
  SELECT 
    'task'::TEXT,
    t.id,
    t.title,
    t.description,
    t.project_id,
    p.name,
    ts_rank(to_tsvector('portuguese', t.title || ' ' || COALESCE(t.description, '')), plainto_tsquery('portuguese', search_query)) AS relevance
  FROM tasks t
  JOIN projects p ON p.id = t.project_id
  WHERE t.deleted_at IS NULL
    AND is_project_member(p_user_id, t.project_id)
    AND (
      t.title ILIKE '%' || search_query || '%'
      OR t.description ILIKE '%' || search_query || '%'
    )
  
  UNION ALL
  
  -- Files
  SELECT 
    'file'::TEXT,
    f.id,
    f.name,
    f.description,
    f.project_id,
    p.name,
    ts_rank(to_tsvector('portuguese', f.name || ' ' || COALESCE(f.description, '')), plainto_tsquery('portuguese', search_query)) AS relevance
  FROM project_files f
  JOIN projects p ON p.id = f.project_id
  WHERE f.deleted_at IS NULL
    AND is_project_member(p_user_id, f.project_id)
    AND (
      f.name ILIKE '%' || search_query || '%'
      OR f.description ILIKE '%' || search_query || '%'
    )
  
  UNION ALL
  
  -- Reports
  SELECT 
    'report'::TEXT,
    r.id,
    r.title,
    r.summary,
    r.project_id,
    p.name,
    ts_rank(to_tsvector('portuguese', r.title || ' ' || COALESCE(r.summary, '')), plainto_tsquery('portuguese', search_query)) AS relevance
  FROM reports r
  JOIN projects p ON p.id = r.project_id
  WHERE r.deleted_at IS NULL
    AND is_project_member(p_user_id, r.project_id)
    AND (
      r.title ILIKE '%' || search_query || '%'
      OR r.summary ILIKE '%' || search_query || '%'
    )
  
  UNION ALL
  
  -- Knowledge Items (NEW)
  SELECT 
    'knowledge'::TEXT,
    k.id,
    k.title,
    k.content,
    k.project_id,
    p.name,
    ts_rank(to_tsvector('portuguese', k.title || ' ' || k.content), plainto_tsquery('portuguese', search_query)) AS relevance
  FROM knowledge_items k
  JOIN projects p ON p.id = k.project_id
  WHERE k.deleted_at IS NULL
    AND is_project_member(p_user_id, k.project_id)
    AND (
      k.title ILIKE '%' || search_query || '%'
      OR k.content ILIKE '%' || search_query || '%'
    )
  
  ORDER BY relevance DESC
  LIMIT 50;
END;
$$;