
-- =============================================
-- 1. EXPERIMENTS TABLE
-- =============================================
CREATE TABLE public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_file_id uuid NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  extraction_job_id uuid REFERENCES public.extraction_jobs(id) ON DELETE SET NULL,
  title text NOT NULL,
  objective text,
  summary text,
  source_type text NOT NULL DEFAULT 'pdf',
  is_qualitative boolean NOT NULL DEFAULT false,
  extracted_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view experiments"
  ON public.experiments FOR SELECT
  USING (deleted_at IS NULL AND is_project_member(auth.uid(), project_id));

CREATE POLICY "Admins can view all experiments"
  ON public.experiments FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Researchers can create experiments"
  ON public.experiments FOR INSERT
  WITH CHECK (auth.uid() = extracted_by AND has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Researchers can update experiments"
  ON public.experiments FOR UPDATE
  USING (has_project_role(auth.uid(), project_id, 'researcher'::project_role));

CREATE POLICY "Managers can delete experiments"
  ON public.experiments FOR DELETE
  USING (has_project_role(auth.uid(), project_id, 'manager'::project_role));

CREATE INDEX idx_experiments_project ON public.experiments(project_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_experiments_file ON public.experiments(source_file_id);
CREATE INDEX idx_experiments_job ON public.experiments(extraction_job_id);

-- =============================================
-- 2. MEASUREMENTS TABLE
-- =============================================
CREATE TABLE public.measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  metric text NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  method text,
  notes text,
  confidence text DEFAULT 'medium',
  source_excerpt text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.measurements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view measurements"
  ON public.measurements FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = measurements.experiment_id
      AND e.deleted_at IS NULL
      AND is_project_member(auth.uid(), e.project_id)
  ));

CREATE POLICY "Researchers can create measurements"
  ON public.measurements FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = measurements.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'researcher'::project_role)
  ));

CREATE POLICY "Researchers can update measurements"
  ON public.measurements FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = measurements.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'researcher'::project_role)
  ));

CREATE POLICY "Managers can delete measurements"
  ON public.measurements FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = measurements.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'manager'::project_role)
  ));

CREATE INDEX idx_measurements_experiment ON public.measurements(experiment_id);
CREATE INDEX idx_measurements_metric ON public.measurements(metric);

-- =============================================
-- 3. EXPERIMENT CONDITIONS TABLE
-- =============================================
CREATE TABLE public.experiment_conditions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.experiment_conditions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view conditions"
  ON public.experiment_conditions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = experiment_conditions.experiment_id
      AND e.deleted_at IS NULL
      AND is_project_member(auth.uid(), e.project_id)
  ));

CREATE POLICY "Researchers can create conditions"
  ON public.experiment_conditions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = experiment_conditions.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'researcher'::project_role)
  ));

CREATE POLICY "Managers can delete conditions"
  ON public.experiment_conditions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = experiment_conditions.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'manager'::project_role)
  ));

CREATE INDEX idx_conditions_experiment ON public.experiment_conditions(experiment_id);

-- =============================================
-- 4. EXPERIMENT CITATIONS TABLE
-- =============================================
CREATE TABLE public.experiment_citations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  measurement_id uuid REFERENCES public.measurements(id) ON DELETE SET NULL,
  file_id uuid NOT NULL REFERENCES public.project_files(id) ON DELETE CASCADE,
  page integer,
  sheet_name text,
  cell_range text,
  excerpt text NOT NULL,
  chunk_id uuid REFERENCES public.search_chunks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.experiment_citations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view citations"
  ON public.experiment_citations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = experiment_citations.experiment_id
      AND e.deleted_at IS NULL
      AND is_project_member(auth.uid(), e.project_id)
  ));

CREATE POLICY "Researchers can create citations"
  ON public.experiment_citations FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = experiment_citations.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'researcher'::project_role)
  ));

CREATE POLICY "Managers can delete citations"
  ON public.experiment_citations FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.id = experiment_citations.experiment_id
      AND has_project_role(auth.uid(), e.project_id, 'manager'::project_role)
  ));

CREATE INDEX idx_citations_experiment ON public.experiment_citations(experiment_id);
CREATE INDEX idx_citations_file ON public.experiment_citations(file_id);

-- =============================================
-- 5. METRICS CATALOG TABLE
-- =============================================
CREATE TABLE public.metrics_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  unit text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  category text NOT NULL DEFAULT 'other',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.metrics_catalog ENABLE ROW LEVEL SECURITY;

-- Everyone can read the catalog
CREATE POLICY "Anyone can view metrics catalog"
  ON public.metrics_catalog FOR SELECT
  USING (true);

-- Only authenticated users can insert (auto-create new metrics)
CREATE POLICY "Authenticated users can create metrics"
  ON public.metrics_catalog FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update metrics"
  ON public.metrics_catalog FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Seed initial R&D dental metrics
INSERT INTO public.metrics_catalog (canonical_name, display_name, unit, aliases, category) VALUES
  ('flexural_strength', 'Resistência Flexural', 'MPa', '{rf,flexural,res_flexural,flexural_strength,resistencia_flexural}', 'mechanical'),
  ('flexural_modulus', 'Módulo Flexural', 'GPa', '{ef,modulo_flexural,elastic_modulus,flexural_modulus}', 'mechanical'),
  ('water_sorption', 'Sorção de Água', 'µg/mm³', '{ws,sorcao,absorcao,water_sorption,sorcao_agua}', 'chemical'),
  ('solubility', 'Solubilidade', 'µg/mm³', '{sol,solubilidade,solubility}', 'chemical'),
  ('hardness_vickers', 'Dureza Vickers', 'HV', '{hv,vickers,dureza_vickers,hardness_vickers,hardness}', 'mechanical'),
  ('hardness_knoop', 'Dureza Knoop', 'KHN', '{khn,knoop,dureza_knoop,hardness_knoop}', 'mechanical'),
  ('delta_e', 'Variação de Cor (ΔE)', 'ΔE', '{de,deltaE,delta_e,variacao_cor}', 'optical'),
  ('degree_of_conversion', 'Grau de Conversão', '%', '{dc,gc,conversao,degree_of_conversion,grau_conversao}', 'chemical'),
  ('compressive_strength', 'Resistência à Compressão', 'MPa', '{cs,compressao,compressive_strength,resistencia_compressao}', 'mechanical'),
  ('tensile_strength', 'Resistência à Tração', 'MPa', '{ts,tracao,tensile_strength,resistencia_tracao}', 'mechanical'),
  ('impact_strength', 'Resistência ao Impacto', 'kJ/m²', '{is,impacto,impact_strength,resistencia_impacto}', 'mechanical'),
  ('surface_roughness', 'Rugosidade Superficial', 'µm', '{ra,rugosidade,surface_roughness,rugosidade_superficial}', 'surface'),
  ('polymerization_shrinkage', 'Contração de Polimerização', '%', '{ps,contracao,polymerization_shrinkage,contracao_polimerizacao}', 'dimensional'),
  ('fracture_toughness', 'Tenacidade à Fratura', 'MPa·m½', '{kic,tenacidade,fracture_toughness,tenacidade_fratura}', 'mechanical'),
  ('translucency', 'Translucidez', '%', '{tp,translucidez,translucency}', 'optical');

-- =============================================
-- 6. ADD content_fingerprint TO project_files
-- =============================================
ALTER TABLE public.project_files ADD COLUMN content_fingerprint text;

CREATE UNIQUE INDEX idx_files_fingerprint_project
  ON public.project_files(project_id, content_fingerprint)
  WHERE deleted_at IS NULL AND content_fingerprint IS NOT NULL;

-- =============================================
-- 7. ADD content_fingerprint TO extraction_jobs
-- =============================================
ALTER TABLE public.extraction_jobs ADD COLUMN content_fingerprint text;
