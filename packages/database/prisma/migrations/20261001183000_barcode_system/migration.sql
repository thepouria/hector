-- Phase 1.5 Barcode System
-- Note: new enum values cannot be referenced in the same transaction that adds them.
-- CODE128 is added here but never used in this migration's DML.

-- Enum: UPC → UPC_A, add CODE128
ALTER TYPE "barcode_type" RENAME VALUE 'UPC' TO 'UPC_A';
ALTER TYPE "barcode_type" ADD VALUE 'CODE128';

-- Extend barcodes
ALTER TABLE "barcodes" ADD COLUMN IF NOT EXISTS "normalized_value" TEXT;
ALTER TABLE "barcodes" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ(3);

-- Backfill normalized_value (type-aware; do not reference newly-added CODE128 here)
UPDATE "barcodes"
SET "normalized_value" = upper(trim(both FROM "value"))
WHERE "type" = 'INTERNAL' AND ("normalized_value" IS NULL OR "normalized_value" = '');

UPDATE "barcodes"
SET "normalized_value" = regexp_replace(trim(both FROM "value"), '\s+', '', 'g')
WHERE "type" IN ('EAN13', 'EAN8', 'UPC_A') AND ("normalized_value" IS NULL OR "normalized_value" = '');

UPDATE "barcodes"
SET "normalized_value" = trim(both FROM "value")
WHERE "normalized_value" IS NULL;

ALTER TABLE "barcodes" ALTER COLUMN "normalized_value" SET NOT NULL;

-- Replace uniqueness: company + value → company + normalized_value
DROP INDEX IF EXISTS "barcodes_company_id_value_key";
DROP INDEX IF EXISTS "barcodes_company_id_normalized_value_key";
CREATE UNIQUE INDEX "barcodes_company_id_normalized_value_key" ON "barcodes"("company_id", "normalized_value");

DROP INDEX IF EXISTS "barcodes_id_company_id_key";
CREATE UNIQUE INDEX "barcodes_id_company_id_key" ON "barcodes"("id", "company_id");

DROP INDEX IF EXISTS "barcodes_company_id_type_idx";
CREATE INDEX "barcodes_company_id_type_idx" ON "barcodes"("company_id", "type");

-- Replace foundation primary index with archived-aware partial unique
DROP INDEX IF EXISTS "barcodes_one_primary_per_sku";
DROP INDEX IF EXISTS "barcodes_sku_one_primary_active";
CREATE UNIQUE INDEX "barcodes_sku_one_primary_active"
  ON "barcodes" ("sku_id")
  WHERE "is_primary" = true AND "archived_at" IS NULL;

-- Pre-existing seed may have multiple INTERNAL barcodes per SKU (Phase 1.1).
-- Keep the primary (or oldest) INTERNAL; reclassify extras as OTHER so the constraint can apply.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY sku_id
      ORDER BY is_primary DESC, created_at ASC, id ASC
    ) AS rn
  FROM "barcodes"
  WHERE "type" = 'INTERNAL' AND "archived_at" IS NULL
)
UPDATE "barcodes" b
SET "type" = 'OTHER'
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

DROP INDEX IF EXISTS "barcodes_sku_one_active_internal";
CREATE UNIQUE INDEX "barcodes_sku_one_active_internal"
  ON "barcodes" ("sku_id")
  WHERE "type" = 'INTERNAL' AND "archived_at" IS NULL;
