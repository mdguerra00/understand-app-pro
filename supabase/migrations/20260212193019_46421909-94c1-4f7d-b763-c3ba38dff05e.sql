
-- Fix security definer views by recreating with SECURITY INVOKER
DROP VIEW IF EXISTS public.experiment_metric_summary;
DROP VIEW IF EXISTS public.condition_metric_summary;

CREATE VIEW public.experiment_metric_summary
WITH (security_invoker = true) AS
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

CREATE VIEW public.condition_metric_summary
WITH (security_invoker = true) AS
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
