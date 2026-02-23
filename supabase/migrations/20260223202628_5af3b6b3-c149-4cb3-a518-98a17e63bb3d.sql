
-- ============================================
-- knowledge_facts: Manual canonical knowledge entries
-- ============================================
CREATE TABLE public.knowledge_facts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id),
  category text NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  value jsonb NOT NULL,
  description text,
  tags text[] DEFAULT '{}',
  authoritative boolean DEFAULT true,
  priority int DEFAULT 100 CHECK (priority BETWEEN 0 AND 100),
  status text DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version int DEFAULT 1,
  embedding extensions.vector(1536)
);

-- Unique constraint: project_id + category + key (handles NULLs via COALESCE)
CREATE UNIQUE INDEX idx_knowledge_facts_unique 
  ON public.knowledge_facts (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'), category, key);

-- HNSW index for embedding similarity search
CREATE INDEX idx_knowledge_facts_embedding 
  ON public.knowledge_facts 
  USING hnsw (embedding extensions.vector_cosine_ops);

-- GIN indexes for tags and value
CREATE INDEX idx_knowledge_facts_tags ON public.knowledge_facts USING gin (tags);
CREATE INDEX idx_knowledge_facts_value ON public.knowledge_facts USING gin (value);

-- Performance indexes
CREATE INDEX idx_knowledge_facts_project_status ON public.knowledge_facts (project_id, status);
CREATE INDEX idx_knowledge_facts_category ON public.knowledge_facts (category);

-- Enable RLS
ALTER TABLE public.knowledge_facts ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- SELECT: authenticated users can see global facts + facts from their projects
CREATE POLICY "Users can view global facts"
  ON public.knowledge_facts FOR SELECT
  USING (project_id IS NULL AND auth.uid() IS NOT NULL);

CREATE POLICY "Members can view project facts"
  ON public.knowledge_facts FOR SELECT
  USING (project_id IS NOT NULL AND is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can view all facts"
  ON public.knowledge_facts FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- INSERT/UPDATE/DELETE: admin or manager of the project
CREATE POLICY "Admins can manage all facts"
  ON public.knowledge_facts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Managers can manage project facts"
  ON public.knowledge_facts FOR INSERT
  WITH CHECK (project_id IS NOT NULL AND has_project_role(auth.uid(), project_id, 'manager'::project_role));

CREATE POLICY "Managers can update project facts"
  ON public.knowledge_facts FOR UPDATE
  USING (project_id IS NOT NULL AND has_project_role(auth.uid(), project_id, 'manager'::project_role));

CREATE POLICY "Managers can delete project facts"
  ON public.knowledge_facts FOR DELETE
  USING (project_id IS NOT NULL AND has_project_role(auth.uid(), project_id, 'manager'::project_role));

-- ============================================
-- knowledge_facts_versions: Version history
-- ============================================
CREATE TABLE public.knowledge_facts_versions (
  id bigserial PRIMARY KEY,
  fact_id uuid NOT NULL REFERENCES public.knowledge_facts(id) ON DELETE CASCADE,
  version int NOT NULL,
  old_value jsonb NOT NULL,
  old_title text NOT NULL,
  change_reason text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kfv_fact_id ON public.knowledge_facts_versions (fact_id);

ALTER TABLE public.knowledge_facts_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view fact versions"
  ON public.knowledge_facts_versions FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert fact versions"
  ON public.knowledge_facts_versions FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- knowledge_facts_logs: Activity log
-- ============================================
CREATE TABLE public.knowledge_facts_logs (
  id bigserial PRIMARY KEY,
  fact_id uuid NOT NULL REFERENCES public.knowledge_facts(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('create', 'update', 'view', 'archive', 'reactivate', 'duplicate')),
  user_id uuid,
  details jsonb,
  timestamp timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_kfl_fact_id ON public.knowledge_facts_logs (fact_id);

ALTER TABLE public.knowledge_facts_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view fact logs"
  ON public.knowledge_facts_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "System can insert fact logs"
  ON public.knowledge_facts_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- Trigger: auto-version on update
-- ============================================
CREATE OR REPLACE FUNCTION public.knowledge_fact_version_trigger()
RETURNS TRIGGER AS $$
BEGIN
  -- Only version if value or title changed
  IF OLD.value IS DISTINCT FROM NEW.value OR OLD.title IS DISTINCT FROM NEW.title THEN
    INSERT INTO public.knowledge_facts_versions (fact_id, version, old_value, old_title, changed_by)
    VALUES (OLD.id, OLD.version, OLD.value, OLD.title, NEW.updated_by);
    
    NEW.version := OLD.version + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER trg_knowledge_fact_version
  BEFORE UPDATE ON public.knowledge_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.knowledge_fact_version_trigger();

-- ============================================
-- Trigger: validate value schema by category
-- ============================================
CREATE OR REPLACE FUNCTION public.validate_knowledge_fact_value()
RETURNS TRIGGER AS $$
BEGIN
  -- Size limit: 5000 bytes
  IF octet_length(NEW.value::text) > 5000 THEN
    RAISE EXCEPTION 'value exceeds 5000 bytes limit';
  END IF;
  
  -- Description limit: 2000 chars
  IF NEW.description IS NOT NULL AND char_length(NEW.description) > 2000 THEN
    RAISE EXCEPTION 'description exceeds 2000 characters limit';
  END IF;
  
  -- Category-specific validation
  IF NEW.category = 'price' THEN
    IF NOT (NEW.value ? 'valor' AND NEW.value ? 'unidade') THEN
      RAISE EXCEPTION 'price category requires valor and unidade fields in value';
    END IF;
    IF jsonb_typeof(NEW.value->'valor') != 'number' THEN
      RAISE EXCEPTION 'price valor must be a number';
    END IF;
  END IF;
  
  IF NEW.category = 'specification' THEN
    IF NOT (NEW.value ? 'spec') THEN
      RAISE EXCEPTION 'specification category requires spec field in value';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_validate_knowledge_fact
  BEFORE INSERT OR UPDATE ON public.knowledge_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_knowledge_fact_value();

-- ============================================
-- Trigger: auto-update updated_at
-- ============================================
CREATE TRIGGER update_knowledge_facts_updated_at
  BEFORE UPDATE ON public.knowledge_facts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
