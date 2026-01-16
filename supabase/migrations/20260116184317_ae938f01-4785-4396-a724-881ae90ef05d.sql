-- Create global search function with RBAC enforcement
CREATE OR REPLACE FUNCTION public.global_search(search_query TEXT)
RETURNS TABLE (
    result_type TEXT,
    result_id UUID,
    title TEXT,
    subtitle TEXT,
    project_id UUID,
    project_name TEXT,
    relevance REAL
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    -- Search Projects
    SELECT 
        'project'::TEXT as result_type,
        p.id as result_id,
        p.name as title,
        p.description as subtitle,
        p.id as project_id,
        p.name as project_name,
        CASE 
            WHEN p.name ILIKE '%' || search_query || '%' THEN 1.0
            WHEN p.description ILIKE '%' || search_query || '%' THEN 0.7
            ELSE 0.5
        END::REAL as relevance
    FROM public.projects p
    WHERE p.deleted_at IS NULL
      AND is_project_member(auth.uid(), p.id)
      AND (
          p.name ILIKE '%' || search_query || '%'
          OR p.description ILIKE '%' || search_query || '%'
          OR p.objectives ILIKE '%' || search_query || '%'
      )
    
    UNION ALL
    
    -- Search Tasks
    SELECT 
        'task'::TEXT as result_type,
        t.id as result_id,
        t.title as title,
        t.description as subtitle,
        t.project_id as project_id,
        proj.name as project_name,
        CASE 
            WHEN t.title ILIKE '%' || search_query || '%' THEN 1.0
            WHEN t.description ILIKE '%' || search_query || '%' THEN 0.7
            ELSE 0.5
        END::REAL as relevance
    FROM public.tasks t
    JOIN public.projects proj ON proj.id = t.project_id
    WHERE t.deleted_at IS NULL
      AND is_project_member(auth.uid(), t.project_id)
      AND (
          t.title ILIKE '%' || search_query || '%'
          OR t.description ILIKE '%' || search_query || '%'
      )
    
    ORDER BY relevance DESC, title
    LIMIT 50;
END;
$$;