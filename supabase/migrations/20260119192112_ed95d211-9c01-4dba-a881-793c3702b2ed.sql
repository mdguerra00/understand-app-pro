-- Add fields to track sheet processing and truncation
ALTER TABLE extraction_jobs 
  ADD COLUMN IF NOT EXISTS sheets_found INTEGER,
  ADD COLUMN IF NOT EXISTS content_truncated BOOLEAN DEFAULT false;