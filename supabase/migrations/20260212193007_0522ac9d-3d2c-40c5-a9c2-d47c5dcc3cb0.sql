
-- ==========================================
-- 1. VIEW: experiment_metric_summary (agregação de measurements)
-- ==========================================
CREATE OR REPLACE VIEW public.experiment_metric_summary AS
SELECT
  m.experiment_id,
  e.project_id,
  e.source_file_id,
  e.title AS experiment_title,
  m.metric,
  m.raw_metric_name,
  m.unit,
  m.method,
  COUNT(*) AS n,
  MIN(m.value) AS min_value,
  MAX(m.value) AS max_value,
  AVG(m.value) AS avg_value,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.value) AS median_value,
  STDDEV(m.value) AS stddev_value,
  AVG(
    CASE m.confidence
      WHEN 'high' THEN 1.0
      WHEN 'medium' THEN 0.7
      WHEN 'low' THEN 0.4
      ELSE 0.5
    END
  ) AS avg_confidence
FROM measurements m
JOIN experiments e ON e.id = m.experiment_id
WHERE e.deleted_at IS NULL
GROUP BY m.experiment_id, e.project_id, e.source_file_id, e.title, m.metric, m.raw_metric_name, m.unit, m.method;

-- ==========================================
-- 2. VIEW: condition_metric_summary (agregação por condição)
-- ==========================================
CREATE OR REPLACE VIEW public.condition_metric_summary AS
SELECT
  e.project_id,
  ec.key AS condition_key,
  ec.value AS condition_value,
  m.metric,
  m.unit,
  COUNT(*) AS n,
  MIN(m.value) AS min_value,
  MAX(m.value) AS max_value,
  AVG(m.value) AS avg_value,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY m.value) AS median_value,
  STDDEV(m.value) AS stddev_value
FROM measurements m
JOIN experiments e ON e.id = m.experiment_id
JOIN experiment_conditions ec ON ec.experiment_id = e.id
WHERE e.deleted_at IS NULL
GROUP BY e.project_id, ec.key, ec.value, m.metric, m.unit;

-- ==========================================
-- 3. Extend metrics_catalog with canonical_unit, unit_aliases, conversion_factor
-- ==========================================
ALTER TABLE public.metrics_catalog
  ADD COLUMN IF NOT EXISTS canonical_unit text,
  ADD COLUMN IF NOT EXISTS unit_aliases text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS conversion_factor numeric DEFAULT 1.0;

-- Set canonical_unit = unit for existing rows
UPDATE public.metrics_catalog SET canonical_unit = unit WHERE canonical_unit IS NULL;

-- ==========================================
-- 4. Add value_canonical + unit_canonical to measurements
-- ==========================================
ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS value_canonical numeric,
  ADD COLUMN IF NOT EXISTS unit_canonical text;

-- Copy existing values as canonical for existing measurements
UPDATE public.measurements SET value_canonical = value, unit_canonical = unit WHERE value_canonical IS NULL;

-- ==========================================
-- 5. Add neighbor_chunk_ids + span fields to knowledge_items
-- ==========================================
ALTER TABLE public.knowledge_items
  ADD COLUMN IF NOT EXISTS neighbor_chunk_ids uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS source_chunk_id uuid,
  ADD COLUMN IF NOT EXISTS human_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_validated boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_validation_reason text;

-- Add foreign key for source_chunk_id
ALTER TABLE public.knowledge_items
  ADD CONSTRAINT knowledge_items_source_chunk_id_fkey
  FOREIGN KEY (source_chunk_id) REFERENCES public.search_chunks(id)
  ON DELETE SET NULL;

-- ==========================================
-- 6. RLS policies for the new views (views inherit from base tables)
-- ==========================================
-- Views use the base table RLS so no extra policies needed.

-- ==========================================
-- 7. Create correlation_jobs table for the engine
-- ==========================================
CREATE TABLE IF NOT EXISTS public.correlation_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  status text NOT NULL DEFAULT 'pending',
  metrics_analyzed integer DEFAULT 0,
  patterns_found integer DEFAULT 0,
  contradictions_found integer DEFAULT 0,
  gaps_found integer DEFAULT 0,
  insights_created integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.correlation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view correlation jobs"
  ON public.correlation_jobs FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can create correlation jobs"
  ON public.correlation_jobs FOR INSERT
  WITH CHECK (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Researchers can update correlation jobs"
  ON public.correlation_jobs FOR UPDATE
  USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));
