-- Phase 1.3 Product Core: normalizedName / normalizedCode uniqueness + search indexes

ALTER TABLE "products" ADD COLUMN "normalized_name" TEXT;
ALTER TABLE "products" ADD COLUMN "normalized_code" TEXT;

-- Backfill from existing rows (codes already stored uppercase from Phase 1.1)
UPDATE "products"
SET
  "normalized_name" = lower(regexp_replace(trim(both FROM "name"), '\s+', ' ', 'g')),
  "normalized_code" = "code";

ALTER TABLE "products" ALTER COLUMN "normalized_name" SET NOT NULL;

DROP INDEX IF EXISTS "products_company_id_code_key";

CREATE UNIQUE INDEX "products_company_id_normalized_code_key" ON "products"("company_id", "normalized_code");
CREATE INDEX "products_company_id_normalized_name_idx" ON "products"("company_id", "normalized_name");
