export interface AcademicPaper {
  id: string;
  doi: string | null;
  title: string;
  authors: Array<{ name: string; affiliation?: string }>;
  abstract: string | null;
  published_date: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  citation_count: number;
  source: string;
  external_id: string | null;
  external_url: string | null;
  keywords: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AcademicSearch {
  id: string;
  query: string;
  source: 'crossref' | 'semantic_scholar' | 'openalex';
  results_count: number;
  raw_response: unknown;
  searched_by: string;
  project_id: string | null;
  research_id: string | null;
  created_at: string;
}

export interface AcademicPaperLink {
  id: string;
  paper_id: string;
  project_id: string | null;
  research_id: string | null;
  linked_by: string;
  notes: string | null;
  relevance_score: number;
  created_at: string;
  academic_papers?: AcademicPaper;
}

export interface AcademicSearchResult {
  results: AcademicPaper[];
  total: number;
  query: string;
  source: string;
}
