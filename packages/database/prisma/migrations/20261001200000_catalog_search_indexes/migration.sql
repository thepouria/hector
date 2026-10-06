-- Phase 1.9: substring search support for Catalog normalized text fields.
-- Exact identifier lookups continue to use unique B-tree indexes on
-- (company_id, normalized_code) / (company_id, normalized_value).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "products_company_id_normalized_name_trgm_idx"
  ON "products" USING GIN ("normalized_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "skus_company_id_normalized_code_trgm_idx"
  ON "skus" USING GIN ("normalized_code" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "brands_company_id_normalized_name_trgm_idx"
  ON "brands" USING GIN ("normalized_name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "categories_company_id_normalized_name_trgm_idx"
  ON "categories" USING GIN ("normalized_name" gin_trgm_ops);
