-- Add evidence verification fields to knowledge_items
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS evidence_verified BOOLEAN DEFAULT false;

-- Add parsing quality tracking to extraction_jobs
ALTER TABLE extraction_jobs ADD COLUMN IF NOT EXISTS parsing_quality TEXT DEFAULT 'unknown';

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_knowledge_items_evidence_verified ON knowledge_items(evidence_verified);