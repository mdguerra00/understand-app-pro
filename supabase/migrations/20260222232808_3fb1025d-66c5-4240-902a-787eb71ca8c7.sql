ALTER TABLE public.rag_logs ADD COLUMN IF NOT EXISTS diagnostics jsonb DEFAULT NULL;
ALTER TABLE public.rag_logs ADD COLUMN IF NOT EXISTS request_id text DEFAULT NULL;