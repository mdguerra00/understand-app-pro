-- Create hybrid search function that combines semantic and full-text search
CREATE OR REPLACE FUNCTION public.search_chunks_hybrid(
  p_query_text text,
  p_query_embedding text,
  p_project_ids uuid[],
  p_limit int DEFAULT 15,
  p_semantic_weight float DEFAULT 0.65,
  p_fts_weight float DEFAULT 0.35
)
RETURNS TABLE(
  chunk_id uuid,
  project_id uuid,
  project_name text,
  source_type text,
  source_id uuid,
  source_title text,
  chunk_text text,
  chunk_index int,
  score_semantic float,
  score_fts float,
  score_final float,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_embedding extensions.vector(1536);
BEGIN
  -- Parse embedding from text format
  v_embedding := p_query_embedding::extensions.vector(1536);
  
  RETURN QUERY
  WITH semantic_results AS (
    SELECT 
      sc.id,
      sc.project_id as proj_id,
      sc.source_type as src_type,
      sc.source_id as src_id,
      sc.chunk_text as text,
      sc.chunk_index as idx,
      sc.metadata as meta,
      (1 - (sc.embedding <=> v_embedding))::float as sem_score
    FROM search_chunks sc
    WHERE sc.project_id = ANY(p_project_ids)
      AND sc.embedding IS NOT NULL
    ORDER BY sc.embedding <=> v_embedding
    LIMIT p_limit * 3
  ),
  fts_results AS (
    SELECT 
      sc.id,
      sc.project_id as proj_id,
      sc.source_type as src_type,
      sc.source_id as src_id,
      sc.chunk_text as text,
      sc.chunk_index as idx,
      sc.metadata as meta,
      ts_rank_cd(sc.tsv, plainto_tsquery('portuguese', p_query_text))::float as fts_score
    FROM search_chunks sc
    WHERE sc.project_id = ANY(p_project_ids)
      AND sc.tsv @@ plainto_tsquery('portuguese', p_query_text)
    ORDER BY fts_score DESC
    LIMIT p_limit * 3
  ),
  combined AS (
    SELECT 
      COALESCE(s.id, f.id) as id,
      COALESCE(s.proj_id, f.proj_id) as proj_id,
      COALESCE(s.src_type, f.src_type) as src_type,
      COALESCE(s.src_id, f.src_id) as src_id,
      COALESCE(s.text, f.text) as text,
      COALESCE(s.idx, f.idx) as idx,
      COALESCE(s.meta, f.meta) as meta,
      COALESCE(s.sem_score, 0)::float as sem_score,
      COALESCE(f.fts_score, 0)::float as fts_score
    FROM semantic_results s
    FULL OUTER JOIN fts_results f ON s.id = f.id
  )
  SELECT 
    c.id as chunk_id,
    c.proj_id as project_id,
    p.name as project_name,
    c.src_type as source_type,
    c.src_id as source_id,
    (c.meta->>'title')::text as source_title,
    c.text as chunk_text,
    c.idx as chunk_index,
    c.sem_score as score_semantic,
    c.fts_score as score_fts,
    (p_semantic_weight * c.sem_score + p_fts_weight * c.fts_score)::float as score_final,
    c.meta as metadata
  FROM combined c
  JOIN projects p ON p.id = c.proj_id
  WHERE p.deleted_at IS NULL
  ORDER BY (p_semantic_weight * c.sem_score + p_fts_weight * c.fts_score) DESC
  LIMIT p_limit;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.search_chunks_hybrid TO authenticated;