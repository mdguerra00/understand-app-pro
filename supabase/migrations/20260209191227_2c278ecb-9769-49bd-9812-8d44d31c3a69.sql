-- Add raw_metric_name to preserve original name before normalization
ALTER TABLE public.measurements ADD COLUMN IF NOT EXISTS raw_metric_name text;

-- Add comment for documentation
COMMENT ON COLUMN public.measurements.raw_metric_name IS 'Original metric name before normalization to canonical form';