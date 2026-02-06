
-- Add relationship columns to knowledge_items
ALTER TABLE public.knowledge_items 
ADD COLUMN IF NOT EXISTS related_items uuid[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS relationship_type text;

-- Add new categories to the knowledge_category enum
ALTER TYPE public.knowledge_category ADD VALUE IF NOT EXISTS 'cross_reference';
ALTER TYPE public.knowledge_category ADD VALUE IF NOT EXISTS 'pattern';
ALTER TYPE public.knowledge_category ADD VALUE IF NOT EXISTS 'contradiction';
ALTER TYPE public.knowledge_category ADD VALUE IF NOT EXISTS 'gap';
