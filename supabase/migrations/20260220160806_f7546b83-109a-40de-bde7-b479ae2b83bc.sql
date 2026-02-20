
-- Fix current_best view to use security_invoker (not security_definer)
-- This makes RLS policies of the querying user apply, not the view creator
CREATE OR REPLACE VIEW public.current_best
WITH (security_invoker = on)
AS
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
