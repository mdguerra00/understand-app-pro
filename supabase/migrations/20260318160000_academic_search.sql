-- Academic search results cache
CREATE TABLE IF NOT EXISTS public.academic_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL,
  source text NOT NULL CHECK (source IN ('crossref', 'semantic_scholar', 'openalex')),
  results_count integer DEFAULT 0,
  raw_response jsonb,
  searched_by uuid REFERENCES auth.users(id),
  project_id uuid REFERENCES public.projects(id),
  research_id uuid REFERENCES public.researches(id),
  created_at timestamptz DEFAULT now()
);

-- Individual academic papers (deduplicated by DOI)
CREATE TABLE IF NOT EXISTS public.academic_papers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doi text UNIQUE,
  title text NOT NULL,
  authors jsonb DEFAULT '[]'::jsonb,
  abstract text,
  published_date date,
  journal text,
  volume text,
  issue text,
  pages text,
  citation_count integer DEFAULT 0,
  source text NOT NULL,
  external_id text,
  external_url text,
  keywords jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Link papers to projects/researches (many-to-many)
CREATE TABLE IF NOT EXISTS public.academic_paper_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  paper_id uuid NOT NULL REFERENCES public.academic_papers(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  research_id uuid REFERENCES public.researches(id) ON DELETE CASCADE,
  linked_by uuid REFERENCES auth.users(id),
  notes text,
  relevance_score numeric(3,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(paper_id, project_id),
  CHECK (project_id IS NOT NULL OR research_id IS NOT NULL)
);

-- RLS policies
ALTER TABLE public.academic_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_papers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_paper_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their searches" ON public.academic_searches
  FOR SELECT USING (auth.uid() = searched_by);

CREATE POLICY "Users can insert searches" ON public.academic_searches
  FOR INSERT WITH CHECK (auth.uid() = searched_by);

CREATE POLICY "Anyone can view papers" ON public.academic_papers
  FOR SELECT USING (true);

CREATE POLICY "Authenticated users can insert papers" ON public.academic_papers
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update papers" ON public.academic_papers
  FOR UPDATE USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can view linked papers" ON public.academic_paper_links
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Users can link papers" ON public.academic_paper_links
  FOR INSERT WITH CHECK (auth.uid() = linked_by);

CREATE POLICY "Users can unlink their papers" ON public.academic_paper_links
  FOR DELETE USING (auth.uid() = linked_by);

-- Indexes
CREATE INDEX idx_academic_papers_doi ON public.academic_papers(doi);
CREATE INDEX idx_academic_papers_title ON public.academic_papers USING gin(to_tsvector('english', title));
CREATE INDEX idx_academic_searches_query ON public.academic_searches(query, source);
CREATE INDEX idx_academic_paper_links_paper ON public.academic_paper_links(paper_id);
CREATE INDEX idx_academic_paper_links_project ON public.academic_paper_links(project_id);
