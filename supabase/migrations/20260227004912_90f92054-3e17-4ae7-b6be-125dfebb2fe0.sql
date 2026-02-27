
-- Phase 1: Add quality/observability metrics to rag_logs
ALTER TABLE public.rag_logs
  ADD COLUMN IF NOT EXISTS groundedness_score real,
  ADD COLUMN IF NOT EXISTS citation_coverage real,
  ADD COLUMN IF NOT EXISTS contradiction_flag boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS complexity_tier text DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS model_escalated boolean DEFAULT false;

-- Add comment for documentation
COMMENT ON COLUMN public.rag_logs.groundedness_score IS 'Auto-evaluated groundedness (0-1): how well the response is supported by retrieved evidence';
COMMENT ON COLUMN public.rag_logs.citation_coverage IS 'Fraction of claims in response that have a citation (0-1)';
COMMENT ON COLUMN public.rag_logs.contradiction_flag IS 'True if contradictions were detected among retrieved chunks';
COMMENT ON COLUMN public.rag_logs.complexity_tier IS 'Model tier used: fast, standard, or advanced';
COMMENT ON COLUMN public.rag_logs.model_escalated IS 'True if the query was escalated from a lower tier to a higher one';

-- Index for analytics queries
CREATE INDEX IF NOT EXISTS idx_rag_logs_complexity_tier ON public.rag_logs (complexity_tier);
CREATE INDEX IF NOT EXISTS idx_rag_logs_created_at ON public.rag_logs (created_at DESC);
