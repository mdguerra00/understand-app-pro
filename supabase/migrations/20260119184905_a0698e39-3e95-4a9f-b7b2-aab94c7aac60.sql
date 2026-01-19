-- Adicionar novas categorias ao enum knowledge_category
ALTER TYPE knowledge_category ADD VALUE IF NOT EXISTS 'finding';
ALTER TYPE knowledge_category ADD VALUE IF NOT EXISTS 'correlation';
ALTER TYPE knowledge_category ADD VALUE IF NOT EXISTS 'anomaly';
ALTER TYPE knowledge_category ADD VALUE IF NOT EXISTS 'benchmark';
ALTER TYPE knowledge_category ADD VALUE IF NOT EXISTS 'recommendation';