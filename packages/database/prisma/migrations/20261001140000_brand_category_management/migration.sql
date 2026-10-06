-- AlterTable: Brand normalized uniqueness
ALTER TABLE "brands" ADD COLUMN "normalized_name" TEXT;

UPDATE "brands"
SET "normalized_name" = lower(
  translate(
    regexp_replace(btrim("name"), '\s+', ' ', 'g'),
    E'\u064A\u0643',
    E'\u06CC\u06A9'
  )
)
WHERE "normalized_name" IS NULL;

ALTER TABLE "brands" ALTER COLUMN "normalized_name" SET NOT NULL;

-- AlterTable: Category hierarchy management fields
ALTER TABLE "categories" ADD COLUMN "normalized_name" TEXT;
ALTER TABLE "categories" ADD COLUMN "code" TEXT;
ALTER TABLE "categories" ADD COLUMN "sort_order" INTEGER NOT NULL DEFAULT 0;

UPDATE "categories"
SET "normalized_name" = lower(
  translate(
    regexp_replace(btrim("name"), '\s+', ' ', 'g'),
    E'\u064A\u0643',
    E'\u06CC\u06A9'
  )
)
WHERE "normalized_name" IS NULL;

ALTER TABLE "categories" ALTER COLUMN "normalized_name" SET NOT NULL;

-- DropIndex (replaced by normalized uniqueness)
DROP INDEX IF EXISTS "brands_company_id_name_idx";

-- CreateIndex
CREATE INDEX "brands_company_id_name_idx" ON "brands"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_company_id_normalized_name_key" ON "brands"("company_id", "normalized_name");

-- CreateIndex
CREATE INDEX "categories_company_id_normalized_name_idx" ON "categories"("company_id", "normalized_name");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_company_id_code_key" ON "categories"("company_id", "code");

-- Sibling uniqueness for non-root categories (parent_id IS NOT NULL)
CREATE UNIQUE INDEX "categories_company_parent_normalized_name_key"
ON "categories" ("company_id", "parent_id", "normalized_name")
WHERE "parent_id" IS NOT NULL;

-- Root uniqueness (parent_id IS NULL) — NULL does not participate in normal UNIQUE
CREATE UNIQUE INDEX "categories_company_root_normalized_name_key"
ON "categories" ("company_id", "normalized_name")
WHERE "parent_id" IS NULL;
