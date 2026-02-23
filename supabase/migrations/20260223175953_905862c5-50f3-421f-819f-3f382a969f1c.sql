
-- Enable pg_trgm extension
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =============================================
-- TABLE: entity_aliases
-- =============================================
CREATE TABLE public.entity_aliases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  entity_type text NOT NULL,
  canonical_name text NOT NULL,
  alias text NOT NULL,
  alias_norm text NOT NULL,
  confidence numeric NOT NULL DEFAULT 1.0,
  approved boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'user_query_suggest',
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  deleted_at timestamptz,
  rejected_at timestamptz,
  rejected_by uuid,
  embedding extensions.vector(1536)
);

-- Indexes
CREATE INDEX idx_entity_aliases_type_approved ON public.entity_aliases (entity_type, approved) WHERE deleted_at IS NULL;
CREATE INDEX idx_entity_aliases_alias_norm_trgm ON public.entity_aliases USING GIN (alias_norm gin_trgm_ops);
CREATE INDEX idx_entity_aliases_embedding ON public.entity_aliases USING hnsw (embedding extensions.vector_cosine_ops) WHERE embedding IS NOT NULL;
CREATE UNIQUE INDEX uq_entity_aliases_type_norm ON public.entity_aliases (entity_type, alias_norm) WHERE deleted_at IS NULL;

-- RLS
ALTER TABLE public.entity_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view aliases"
  ON public.entity_aliases FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admins can manage aliases"
  ON public.entity_aliases FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Service role full access to aliases"
  ON public.entity_aliases FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- TABLE: alias_cache (project-scoped KV)
-- =============================================
CREATE TABLE public.alias_cache (
  project_id uuid NOT NULL,
  term_norm text NOT NULL,
  entity_type text NOT NULL,
  result jsonb NOT NULL,
  cached_at timestamptz NOT NULL DEFAULT now(),
  hit_count integer NOT NULL DEFAULT 1,
  last_hit_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, term_norm, entity_type)
);

CREATE INDEX idx_alias_cache_project_cached ON public.alias_cache (project_id, cached_at DESC);

-- RLS: service_role only
ALTER TABLE public.alias_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.alias_cache FROM anon, authenticated;

CREATE POLICY "Service role full access to alias_cache"
  ON public.alias_cache FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- TABLE: migration_logs
-- =============================================
CREATE TABLE public.migration_logs (
  id bigserial PRIMARY KEY,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error')),
  context jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: service_role only
ALTER TABLE public.migration_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.migration_logs FROM anon, authenticated;
REVOKE ALL ON SEQUENCE public.migration_logs_id_seq FROM anon, authenticated;

CREATE POLICY "Service role full access to migration_logs"
  ON public.migration_logs FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- =============================================
-- pg_cron: cleanup alias_cache every 10 min, log deletions
-- =============================================
SELECT cron.schedule(
  'cleanup-alias-cache',
  '*/10 * * * *',
  $$
  DO $do$
  DECLARE
    v_deleted integer;
  BEGIN
    DELETE FROM public.alias_cache WHERE cached_at < now() - interval '30 minutes';
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted > 0 THEN
      INSERT INTO public.migration_logs (message, severity, context)
      VALUES (
        format('alias_cache cleanup: %s rows deleted', v_deleted),
        'info',
        jsonb_build_object('rows_deleted', v_deleted, 'trigger', 'pg_cron')
      );
    END IF;
  END $do$;
  $$
);

-- =============================================
-- SEED: entity_aliases from metrics_catalog + hardcoded maps
-- =============================================
DO $$
DECLARE
  v_row record;
  v_alias text;
  v_collision_count integer := 0;
BEGIN
  -- 1) Seed from metrics_catalog
  FOR v_row IN
    SELECT canonical_name, unnest(aliases) AS alias_val
    FROM public.metrics_catalog
    WHERE array_length(aliases, 1) > 0
  LOOP
    BEGIN
      INSERT INTO public.entity_aliases (entity_type, canonical_name, alias, alias_norm, confidence, approved, source)
      VALUES ('metric', v_row.canonical_name, v_row.alias_val, lower(trim(v_row.alias_val)), 1.0, true, 'legacy_hardcoded');
    EXCEPTION WHEN unique_violation THEN
      v_collision_count := v_collision_count + 1;
    END;
  END LOOP;

  -- 2) Property aliases (propTermMap)
  FOREACH v_alias IN ARRAY ARRAY[
    'flexural_strength:flexural strength', 'flexural_strength:resistencia flexural', 'flexural_strength:rf',
    'flexural_modulus:flexural modulus', 'flexural_modulus:modulo flexural', 'flexural_modulus:mf',
    'color:delta_e', 'color:yellowing', 'color:cor', 'color:amarelamento',
    'hardness:dureza', 'hardness:vickers', 'hardness:knoop', 'hardness:hv', 'hardness:khn',
    'water_sorption:sorção', 'water_sorption:sorption', 'water_sorption:absorção de água',
    'degree_of_conversion:conversão', 'degree_of_conversion:conversion', 'degree_of_conversion:dc',
    'elastic_modulus:módulo elástico', 'elastic_modulus:elastic modulus', 'elastic_modulus:young'
  ]
  LOOP
    BEGIN
      INSERT INTO public.entity_aliases (entity_type, canonical_name, alias, alias_norm, confidence, approved, source)
      VALUES ('metric', split_part(v_alias, ':', 1), split_part(v_alias, ':', 2), lower(trim(split_part(v_alias, ':', 2))), 1.0, true, 'legacy_hardcoded');
    EXCEPTION WHEN unique_violation THEN
      v_collision_count := v_collision_count + 1;
    END;
  END LOOP;

  -- 3) Additive aliases
  FOREACH v_alias IN ARRAY ARRAY[
    'silver_nanoparticles:silver', 'silver_nanoparticles:prata', 'silver_nanoparticles:agnp', 'silver_nanoparticles:nano prata', 'silver_nanoparticles:nanosilver', 'silver_nanoparticles:ag-np',
    'silica_nanoparticle:nano silica', 'silica_nanoparticle:nano sílica', 'silica_nanoparticle:sio2',
    'bomar:bomar',
    'tegdma:tegdma',
    'udma:udma',
    'bisgma:bisgma', 'bisgma:bis-gma',
    'hals:hals',
    'uv_absorber:uv absorber', 'uv_absorber:absorvedor uv',
    'antioxidant:antioxidant', 'antioxidant:antioxidante'
  ]
  LOOP
    BEGIN
      INSERT INTO public.entity_aliases (entity_type, canonical_name, alias, alias_norm, confidence, approved, source)
      VALUES ('additive', split_part(v_alias, ':', 1), split_part(v_alias, ':', 2), lower(trim(split_part(v_alias, ':', 2))), 1.0, true, 'legacy_hardcoded');
    EXCEPTION WHEN unique_violation THEN
      v_collision_count := v_collision_count + 1;
    END;
  END LOOP;

  -- 4) Material aliases
  FOREACH v_alias IN ARRAY ARRAY[
    'vitality:vitality',
    'filtek:filtek',
    'charisma:charisma',
    'tetric:tetric',
    'grandio:grandio',
    'z350:z350', 'z350:z 350',
    'z250:z250', 'z250:z 250',
    'brilliant:brilliant',
    'herculite:herculite',
    'clearfil:clearfil',
    'estelite:estelite',
    'ips:ips',
    'ceram:ceram',
    'nextdent:nextdent',
    'keysplint:keysplint',
    'luxaprint:luxaprint'
  ]
  LOOP
    BEGIN
      INSERT INTO public.entity_aliases (entity_type, canonical_name, alias, alias_norm, confidence, approved, source)
      VALUES ('material', split_part(v_alias, ':', 1), split_part(v_alias, ':', 2), lower(trim(split_part(v_alias, ':', 2))), 1.0, true, 'legacy_hardcoded');
    EXCEPTION WHEN unique_violation THEN
      v_collision_count := v_collision_count + 1;
    END;
  END LOOP;

  -- Log collisions
  IF v_collision_count > 0 THEN
    INSERT INTO public.migration_logs (message, severity, context)
    VALUES (
      format('Seed completed with %s collisions (ON CONFLICT skipped)', v_collision_count),
      'warning',
      jsonb_build_object('collisions', v_collision_count)
    );
  END IF;

  INSERT INTO public.migration_logs (message, severity, context)
  VALUES ('entity_aliases seed completed', 'info', jsonb_build_object('source', 'initial_migration'));
END $$;
