
-- ============================================================
-- MIGRATION: Temporal Evidence System
-- (A) evidence_date on experiments & measurements
-- (B) claims table (comparative/temporal/superlative)
-- (C) benchmarks table (revocable snapshots)
-- (D) current_best view
-- (E) auto-superseding function
-- ============================================================

-- A1) Add evidence_date to experiments (effective date of evidence)
ALTER TABLE public.experiments
  ADD COLUMN IF NOT EXISTS evidence_date timestamptz,
  ADD COLUMN IF NOT EXISTS doc_date date;

-- Default evidence_date to created_at where NULL
UPDATE public.experiments SET evidence_date = created_at WHERE evidence_date IS NULL;

-- A2) Add evidence_date to measurements (inherits from experiment if NULL)
ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS evidence_date timestamptz;

UPDATE public.measurements m
SET evidence_date = e.created_at
FROM public.experiments e
WHERE m.experiment_id = e.id AND m.evidence_date IS NULL;

-- B) CLAIMS TABLE: comparative/temporal/superlative assertions extracted from text
CREATE TABLE IF NOT EXISTS public.claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_file_id uuid REFERENCES public.project_files(id),
  source_experiment_id uuid REFERENCES public.experiments(id),
  excerpt        text NOT NULL,
  claim_type     text NOT NULL CHECK (claim_type IN ('comparative', 'temporal', 'superlative', 'benchmark_ref')),
  metric_key     text,
  entities       text[],
  scope_definition jsonb DEFAULT '{}'::jsonb,
  evidence_date  timestamptz,
  confidence     numeric DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'uncertain')),
  superseded_by  uuid REFERENCES public.claims(id),
  superseded_at  timestamptz,
  superseded_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_claims_project_id ON public.claims(project_id);
CREATE INDEX IF NOT EXISTS idx_claims_metric_key ON public.claims(metric_key);
CREATE INDEX IF NOT EXISTS idx_claims_status ON public.claims(status);
CREATE INDEX IF NOT EXISTS idx_claims_source_file ON public.claims(source_file_id);

-- RLS for claims
ALTER TABLE public.claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view claims"
  ON public.claims FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can insert claims"
  ON public.claims FOR INSERT
  WITH CHECK (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Researchers can update claims"
  ON public.claims FOR UPDATE
  USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Admins can view all claims"
  ON public.claims FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- C) BENCHMARKS TABLE: revocable snapshots of comparative conclusions
CREATE TABLE IF NOT EXISTS public.benchmarks (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  metric_key                 text NOT NULL,
  scope_definition           jsonb DEFAULT '{}'::jsonb,
  baseline_value             numeric NOT NULL,
  baseline_unit              text NOT NULL,
  baseline_unit_canonical    text,
  baseline_value_canonical   numeric,
  material_label             text,
  experiment_id              uuid REFERENCES public.experiments(id),
  measurement_id             uuid REFERENCES public.measurements(id),
  source_file_id             uuid REFERENCES public.project_files(id),
  source_claim_id            uuid REFERENCES public.claims(id),
  source_excerpt             text,
  as_of_date                 timestamptz NOT NULL,
  status                     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'superseded', 'uncertain')),
  superseded_by_benchmark_id uuid REFERENCES public.benchmarks(id),
  superseded_by_measurement_id uuid REFERENCES public.measurements(id),
  superseded_at              timestamptz,
  notes                      text,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_benchmarks_fingerprint
  ON public.benchmarks(project_id, metric_key, baseline_value, baseline_unit, as_of_date);

CREATE INDEX IF NOT EXISTS idx_benchmarks_metric_status ON public.benchmarks(metric_key, status);
CREATE INDEX IF NOT EXISTS idx_benchmarks_project ON public.benchmarks(project_id);

ALTER TABLE public.benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view benchmarks"
  ON public.benchmarks FOR SELECT
  USING (is_project_member(auth.uid(), project_id));

CREATE POLICY "Researchers can insert benchmarks"
  ON public.benchmarks FOR INSERT
  WITH CHECK (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Researchers can update benchmarks"
  ON public.benchmarks FOR UPDATE
  USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Admins can view all benchmarks"
  ON public.benchmarks FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- D) current_best VIEW: best measurement per (project, metric_key, unit_canonical)
-- Ordered by: value desc (normalized), then evidence_date desc, then confidence
CREATE OR REPLACE VIEW public.current_best AS
WITH ranked AS (
  SELECT
    m.id              AS measurement_id,
    e.project_id,
    e.id              AS experiment_id,
    e.title           AS experiment_title,
    e.source_file_id  AS doc_id,
    m.metric          AS metric_key,
    m.raw_metric_name,
    m.value,
    m.unit,
    COALESCE(m.value_canonical, m.value)  AS value_canonical,
    COALESCE(m.unit_canonical, m.unit)    AS unit_canonical,
    m.source_excerpt  AS excerpt,
    m.confidence,
    COALESCE(m.evidence_date, e.evidence_date, e.created_at) AS evidence_date,
    ROW_NUMBER() OVER (
      PARTITION BY e.project_id, m.metric, COALESCE(m.unit_canonical, m.unit)
      ORDER BY
        COALESCE(m.value_canonical, m.value) DESC,
        COALESCE(m.evidence_date, e.evidence_date, e.created_at) DESC,
        CASE m.confidence WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END DESC
    ) AS rn
  FROM public.measurements m
  JOIN public.experiments e ON e.id = m.experiment_id
  WHERE e.deleted_at IS NULL
)
SELECT
  measurement_id, project_id, experiment_id, experiment_title,
  doc_id, metric_key, raw_metric_name,
  value, unit, value_canonical, unit_canonical,
  excerpt, confidence, evidence_date
FROM ranked
WHERE rn = 1;

-- E) Auto-superseding function (called after new measurement/claim inserted)
CREATE OR REPLACE FUNCTION public.check_and_supersede_claims(
  p_project_id uuid,
  p_metric_key text,
  p_new_value_canonical numeric,
  p_new_measurement_id uuid,
  p_new_evidence_date timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_superseded_count integer := 0;
  v_claim record;
  v_benchmark record;
BEGIN
  -- Supersede active claims of comparative/temporal/superlative type
  -- for the same metric where the new measurement is strictly superior
  FOR v_claim IN
    SELECT id
    FROM public.claims
    WHERE project_id = p_project_id
      AND metric_key = p_metric_key
      AND status = 'active'
      AND claim_type IN ('comparative', 'temporal', 'superlative', 'benchmark_ref')
      AND (evidence_date IS NULL OR evidence_date < p_new_evidence_date)
  LOOP
    UPDATE public.claims
    SET
      status = 'superseded',
      superseded_at = now(),
      superseded_reason = format(
        'Superado por measurement %s com valor_canonical %s em %s',
        p_new_measurement_id, p_new_value_canonical,
        to_char(p_new_evidence_date, 'YYYY-MM-DD')
      ),
      updated_at = now()
    WHERE id = v_claim.id;
    v_superseded_count := v_superseded_count + 1;
  END LOOP;

  -- Supersede active benchmarks for the same metric where new measurement is superior
  FOR v_benchmark IN
    SELECT id, baseline_value_canonical
    FROM public.benchmarks
    WHERE project_id = p_project_id
      AND metric_key = p_metric_key
      AND status = 'active'
  LOOP
    IF p_new_value_canonical > COALESCE(v_benchmark.baseline_value_canonical, 0)
       AND p_new_evidence_date > COALESCE(
         (SELECT as_of_date FROM public.benchmarks WHERE id = v_benchmark.id),
         '1970-01-01'::timestamptz
       )
    THEN
      UPDATE public.benchmarks
      SET
        status = 'superseded',
        superseded_by_measurement_id = p_new_measurement_id,
        superseded_at = now(),
        notes = format(
          'Superado em %s: novo valor %s > baseline %s',
          to_char(p_new_evidence_date, 'YYYY-MM-DD'),
          p_new_value_canonical,
          v_benchmark.baseline_value_canonical
        ),
        updated_at = now()
      WHERE id = v_benchmark.id;
      v_superseded_count := v_superseded_count + 1;
    END IF;
  END LOOP;

  RETURN v_superseded_count;
END;
$$;

-- F) Migrate existing benchmark knowledge_items to uncertain status claims
-- (run as data migration - safe to run multiple times due to WHERE NOT EXISTS)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT ki.id, ki.project_id, ki.source_file_id, ki.content, ki.evidence,
           ki.confidence, ki.ref_metric_key, ki.extracted_at, ki.ref_experiment_id
    FROM public.knowledge_items ki
    WHERE ki.category = 'benchmark'
      AND ki.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.claims c
        WHERE c.source_file_id = ki.source_file_id
          AND c.metric_key = ki.ref_metric_key
          AND c.excerpt = LEFT(ki.evidence, 500)
      )
  LOOP
    INSERT INTO public.claims (
      project_id, source_file_id, source_experiment_id,
      excerpt, claim_type, metric_key, evidence_date,
      confidence, status, scope_definition
    ) VALUES (
      r.project_id, r.source_file_id, r.ref_experiment_id,
      COALESCE(r.evidence, r.content, ''), 'benchmark_ref', r.ref_metric_key,
      r.extracted_at,
      COALESCE(r.confidence / 1.0, 0.5),
      'uncertain',  -- start as uncertain; superseding job will reclassify
      jsonb_build_object('project_id', r.project_id, 'migrated_from', 'knowledge_items')
    );
  END LOOP;
END;
$$;

-- G) Update timestamps trigger for claims and benchmarks
CREATE TRIGGER update_claims_updated_at
  BEFORE UPDATE ON public.claims
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_benchmarks_updated_at
  BEFORE UPDATE ON public.benchmarks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
