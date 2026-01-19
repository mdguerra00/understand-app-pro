-- Add fields to track AI-generated reports
ALTER TABLE reports 
  ADD COLUMN IF NOT EXISTS generated_by_ai BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_model_used TEXT,
  ADD COLUMN IF NOT EXISTS source_insights_count INTEGER;

COMMENT ON COLUMN reports.generated_by_ai IS 'Whether this report was generated using AI';
COMMENT ON COLUMN reports.ai_model_used IS 'The AI model used for generation (e.g., google/gemini-3-flash-preview)';
COMMENT ON COLUMN reports.source_insights_count IS 'Number of knowledge insights used as source for AI generation';