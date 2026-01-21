-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- Table for storing indexed content chunks with embeddings
CREATE TABLE public.search_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('report', 'task', 'comment', 'file', 'insight')),
  source_id uuid NOT NULL,
  chunk_index int NOT NULL DEFAULT 0,
  chunk_text text NOT NULL,
  chunk_hash text NOT NULL,
  tsv tsvector GENERATED ALWAYS AS (to_tsvector('portuguese', chunk_text)) STORED,
  embedding extensions.vector(1536),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  
  UNIQUE(project_id, source_type, source_id, chunk_index),
  UNIQUE(project_id, chunk_hash)
);

-- Indexes for efficient search
CREATE INDEX idx_search_chunks_project ON public.search_chunks(project_id);
CREATE INDEX idx_search_chunks_source ON public.search_chunks(source_type, source_id);
CREATE INDEX idx_search_chunks_tsv ON public.search_chunks USING gin(tsv);

-- Job queue for async indexing
CREATE TABLE public.indexing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type text NOT NULL CHECK (job_type IN ('index_report', 'index_task', 'index_file', 'index_insight', 'reindex_project')),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type text,
  source_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'error')),
  priority int NOT NULL DEFAULT 5,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  chunks_created int DEFAULT 0,
  retry_count int DEFAULT 0
);

CREATE INDEX idx_indexing_jobs_status ON public.indexing_jobs(status, priority DESC, created_at);
CREATE INDEX idx_indexing_jobs_project ON public.indexing_jobs(project_id);

-- RAG logs for auditing
CREATE TABLE public.rag_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  query text NOT NULL,
  query_embedding extensions.vector(1536),
  chunks_used uuid[],
  chunks_count int,
  response_summary text,
  tokens_input int,
  tokens_output int,
  model_used text,
  latency_ms int,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_rag_logs_user ON public.rag_logs(user_id, created_at DESC);

-- Enable RLS on all new tables
ALTER TABLE public.search_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.indexing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rag_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for search_chunks
CREATE POLICY "Members can view project chunks"
  ON public.search_chunks FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can manage chunks"
  ON public.search_chunks FOR ALL
  USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

-- RLS Policies for indexing_jobs
CREATE POLICY "Members can view indexing jobs"
  ON public.indexing_jobs FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can create indexing jobs"
  ON public.indexing_jobs FOR INSERT
  WITH CHECK (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Researchers can update indexing jobs"
  ON public.indexing_jobs FOR UPDATE
  USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

-- RLS Policies for rag_logs
CREATE POLICY "Users can view own RAG logs"
  ON public.rag_logs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own RAG logs"
  ON public.rag_logs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all RAG logs"
  ON public.rag_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Function to queue indexing job when content is created/updated
CREATE OR REPLACE FUNCTION public.queue_content_indexing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job_type text;
  v_project_id uuid;
BEGIN
  -- Determine job type and project_id based on table
  IF TG_TABLE_NAME = 'reports' THEN
    v_job_type := 'index_report';
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    v_job_type := 'index_task';
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'knowledge_items' THEN
    v_job_type := 'index_insight';
    v_project_id := NEW.project_id;
  ELSIF TG_TABLE_NAME = 'project_files' THEN
    v_job_type := 'index_file';
    v_project_id := NEW.project_id;
  END IF;

  -- Only queue if not deleted
  IF NEW.deleted_at IS NULL THEN
    INSERT INTO public.indexing_jobs (job_type, project_id, source_type, source_id, created_by)
    VALUES (v_job_type, v_project_id, TG_TABLE_NAME, NEW.id, auth.uid())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- Triggers for automatic indexing
CREATE TRIGGER trigger_index_report
  AFTER INSERT OR UPDATE OF title, content, summary ON public.reports
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.queue_content_indexing();

CREATE TRIGGER trigger_index_task
  AFTER INSERT OR UPDATE OF title, description ON public.tasks
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.queue_content_indexing();

CREATE TRIGGER trigger_index_insight
  AFTER INSERT OR UPDATE OF title, content, evidence ON public.knowledge_items
  FOR EACH ROW
  WHEN (NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public.queue_content_indexing();