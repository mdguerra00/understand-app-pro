
-- Add audit columns to measurements (value_raw, header_raw)
ALTER TABLE public.measurements ADD COLUMN IF NOT EXISTS value_raw text;
ALTER TABLE public.measurements ADD COLUMN IF NOT EXISTS header_raw text;

-- Upsert filler_content into metrics_catalog
INSERT INTO public.metrics_catalog (canonical_name, display_name, unit, canonical_unit, conversion_factor, aliases, unit_aliases, category)
VALUES (
  'filler_content',
  'Filler Content',
  'pct',
  'pct',
  1,
  ARRAY['filler_content', 'filler', 'carga', 'load', 'wt%', 'weight %', 'glass content', 'ceramic content', '% filler', '% carga', 'filler wt%', 'filled fraction', 'filler fraction', 'glass', 'ceramic', 'filled', 'filler content', 'carga inorgânica', 'carga inorganica', 'conteúdo de carga', 'conteudo de carga'],
  ARRAY['%', 'pct', 'percent', 'fraction', 'wt%'],
  'composition'
)
ON CONFLICT (canonical_name) DO UPDATE SET
  aliases = EXCLUDED.aliases,
  unit_aliases = EXCLUDED.unit_aliases,
  canonical_unit = 'pct',
  conversion_factor = 1;
