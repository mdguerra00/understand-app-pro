
-- Add parsed Excel cell location columns to measurements
ALTER TABLE public.measurements
  ADD COLUMN IF NOT EXISTS sheet_name TEXT,
  ADD COLUMN IF NOT EXISTS row_idx INTEGER,
  ADD COLUMN IF NOT EXISTS col_idx INTEGER,
  ADD COLUMN IF NOT EXISTS cell_addr TEXT;

-- Create index for tabular queries
CREATE INDEX IF NOT EXISTS idx_measurements_tabular
  ON public.measurements (experiment_id, sheet_name, row_idx);

-- Backfill from source_excerpt: parse "Sheet: X, Row: Y, Col: Z"
UPDATE public.measurements
SET
  sheet_name = (regexp_match(source_excerpt, 'Sheet:\s*([^,]+)'))[1],
  row_idx = ((regexp_match(source_excerpt, 'Row:\s*(\d+)'))[1])::integer,
  cell_addr = (regexp_match(source_excerpt, 'Col:\s*([^,]+)'))[1]
WHERE source_excerpt LIKE '%Sheet:%'
  AND sheet_name IS NULL;

-- Ensure filler_content exists in metrics_catalog
INSERT INTO public.metrics_catalog (canonical_name, display_name, unit, aliases, category, canonical_unit, unit_aliases)
VALUES (
  'filler_content',
  'Filler Content',
  '%',
  ARRAY['carga', 'filler', 'load', 'wt%', '% carga', 'filler wt%', 'glass content', 'ceramic content', 'filled fraction', 'filler fraction', 'filler content', 'conteúdo de carga', 'teor de carga'],
  'composition',
  'pct',
  ARRAY['%', 'wt%', 'fraction', 'vol%']
)
ON CONFLICT (canonical_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  canonical_unit = EXCLUDED.canonical_unit,
  unit_aliases = EXCLUDED.unit_aliases;
