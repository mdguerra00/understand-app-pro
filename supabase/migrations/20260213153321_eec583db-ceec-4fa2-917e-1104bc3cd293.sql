
-- 1. Add hypothesis fields to experiments
ALTER TABLE public.experiments 
ADD COLUMN IF NOT EXISTS hypothesis text,
ADD COLUMN IF NOT EXISTS expected_outcome text;

-- 2. Create document_structure table for hierarchical section detection
CREATE TABLE public.document_structure (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id uuid NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  section_type text NOT NULL DEFAULT 'unknown', -- methods, results, discussion, conclusion, introduction, abstract, references, table, figure
  section_title text,
  start_chunk_id uuid REFERENCES public.search_chunks(id) ON DELETE SET NULL,
  end_chunk_id uuid REFERENCES public.search_chunks(id) ON DELETE SET NULL,
  section_index integer NOT NULL DEFAULT 0,
  content_preview text, -- first 500 chars of section
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.document_structure ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view document structure"
ON public.document_structure FOR SELECT
USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can manage document structure"
ON public.document_structure FOR ALL
USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

-- 3. Add memory graph reference fields to knowledge_items
ALTER TABLE public.knowledge_items
ADD COLUMN IF NOT EXISTS ref_experiment_id uuid REFERENCES public.experiments(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS ref_metric_key text,
ADD COLUMN IF NOT EXISTS ref_condition_key text;

-- Index for memory graph queries
CREATE INDEX IF NOT EXISTS idx_ki_ref_experiment ON public.knowledge_items(ref_experiment_id) WHERE ref_experiment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ki_ref_metric ON public.knowledge_items(ref_metric_key) WHERE ref_metric_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ki_ref_condition ON public.knowledge_items(ref_condition_key) WHERE ref_condition_key IS NOT NULL;

-- Index for document structure queries
CREATE INDEX IF NOT EXISTS idx_doc_structure_file ON public.document_structure(file_id);
CREATE INDEX IF NOT EXISTS idx_doc_structure_type ON public.document_structure(section_type);
