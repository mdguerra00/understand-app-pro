
-- Make project_id nullable to allow global files
ALTER TABLE public.project_files ALTER COLUMN project_id DROP NOT NULL;

-- RLS: Any authenticated user can view global files
CREATE POLICY "Users can view global files"
ON public.project_files FOR SELECT
USING (project_id IS NULL AND deleted_at IS NULL AND auth.uid() IS NOT NULL);

-- RLS: Any authenticated user can upload global files
CREATE POLICY "Users can upload global files"
ON public.project_files FOR INSERT
WITH CHECK (project_id IS NULL AND auth.uid() = uploaded_by);

-- RLS: Uploaders can update their global files
CREATE POLICY "Uploaders can update global files"
ON public.project_files FOR UPDATE
USING (project_id IS NULL AND auth.uid() = uploaded_by);

-- RLS: Uploaders or admins can delete global files
CREATE POLICY "Uploaders can delete global files"
ON public.project_files FOR DELETE
USING (project_id IS NULL AND (auth.uid() = uploaded_by OR has_role(auth.uid(), 'admin'::app_role)));

-- Also make extraction_jobs.project_id nullable for global file extractions
ALTER TABLE public.extraction_jobs ALTER COLUMN project_id DROP NOT NULL;

-- RLS for global extraction jobs
CREATE POLICY "Users can view global extraction jobs"
ON public.extraction_jobs FOR SELECT
USING (project_id IS NULL AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can create global extraction jobs"
ON public.extraction_jobs FOR INSERT
WITH CHECK (project_id IS NULL AND auth.uid() = created_by);

CREATE POLICY "Users can update global extraction jobs"
ON public.extraction_jobs FOR UPDATE
USING (project_id IS NULL AND auth.uid() = created_by);

-- Make search_chunks.project_id nullable for global content indexing
ALTER TABLE public.search_chunks ALTER COLUMN project_id DROP NOT NULL;

-- RLS for global search chunks
CREATE POLICY "Users can view global chunks"
ON public.search_chunks FOR SELECT
USING (project_id IS NULL AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can manage global chunks"
ON public.search_chunks FOR ALL
USING (project_id IS NULL AND auth.uid() IS NOT NULL);

-- Make knowledge_items.project_id nullable for global insights
ALTER TABLE public.knowledge_items ALTER COLUMN project_id DROP NOT NULL;

-- RLS for global knowledge items
CREATE POLICY "Users can view global knowledge items"
ON public.knowledge_items FOR SELECT
USING (project_id IS NULL AND deleted_at IS NULL AND auth.uid() IS NOT NULL);

CREATE POLICY "Users can create global knowledge items"
ON public.knowledge_items FOR INSERT
WITH CHECK (project_id IS NULL AND auth.uid() = extracted_by);

CREATE POLICY "Users can update global knowledge items"
ON public.knowledge_items FOR UPDATE
USING (project_id IS NULL AND auth.uid() IS NOT NULL);
