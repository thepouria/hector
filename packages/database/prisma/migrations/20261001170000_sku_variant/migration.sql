-- Phase 1.4 SKU / Variant

-- Extend skus
ALTER TABLE "skus" ADD COLUMN "normalized_code" TEXT;
ALTER TABLE "skus" ADD COLUMN "variant_signature" TEXT;

UPDATE "skus"
SET "normalized_code" = upper(trim(both FROM "code"));

-- Legacy rows: first SKU per product becomes SIMPLE; extra SKUs (pre-variant era) get a
-- unique LEGACY signature so the unique index can be created. Seed/data migration replaces them.
UPDATE "skus" s
SET "variant_signature" = CASE
  WHEN s."id" = (
    SELECT s2."id" FROM "skus" s2
    WHERE s2."product_id" = s."product_id"
    ORDER BY s2."created_at" ASC, s2."id" ASC
    LIMIT 1
  ) THEN 'SIMPLE'
  ELSE 'LEGACY:' || s."id"::text
END;

ALTER TABLE "skus" ALTER COLUMN "normalized_code" SET NOT NULL;
ALTER TABLE "skus" ALTER COLUMN "variant_signature" SET NOT NULL;

DROP INDEX IF EXISTS "skus_company_id_code_key";
CREATE UNIQUE INDEX "skus_company_id_normalized_code_key" ON "skus"("company_id", "normalized_code");
CREATE UNIQUE INDEX "skus_product_id_variant_signature_key" ON "skus"("product_id", "variant_signature");

-- Variant options
CREATE TABLE "variant_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variant_options_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_options_id_company_id_key" ON "variant_options"("id", "company_id");
CREATE UNIQUE INDEX "variant_options_id_product_id_key" ON "variant_options"("id", "product_id");
CREATE UNIQUE INDEX "variant_options_product_id_normalized_name_key" ON "variant_options"("product_id", "normalized_name");
CREATE INDEX "variant_options_company_id_product_id_idx" ON "variant_options"("company_id", "product_id");
CREATE INDEX "variant_options_product_id_position_idx" ON "variant_options"("product_id", "position");

ALTER TABLE "variant_options" ADD CONSTRAINT "variant_options_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_options" ADD CONSTRAINT "variant_options_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Variant option values
CREATE TABLE "variant_option_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "variant_option_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "variant_option_values_id_company_id_key" ON "variant_option_values"("id", "company_id");
CREATE UNIQUE INDEX "variant_option_values_id_option_id_key" ON "variant_option_values"("id", "option_id");
CREATE UNIQUE INDEX "variant_option_values_option_id_normalized_value_key" ON "variant_option_values"("option_id", "normalized_value");
CREATE INDEX "variant_option_values_company_id_option_id_idx" ON "variant_option_values"("company_id", "option_id");
CREATE INDEX "variant_option_values_option_id_position_idx" ON "variant_option_values"("option_id", "position");

ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "variant_option_values" ADD CONSTRAINT "variant_option_values_option_id_company_id_fkey" FOREIGN KEY ("option_id", "company_id") REFERENCES "variant_options"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SKU option values join
CREATE TABLE "sku_option_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,
    "option_value_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_option_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sku_option_values_sku_id_option_id_key" ON "sku_option_values"("sku_id", "option_id");
CREATE UNIQUE INDEX "sku_option_values_sku_id_option_value_id_key" ON "sku_option_values"("sku_id", "option_value_id");
CREATE INDEX "sku_option_values_option_value_id_idx" ON "sku_option_values"("option_value_id");
CREATE INDEX "sku_option_values_company_id_sku_id_idx" ON "sku_option_values"("company_id", "sku_id");

ALTER TABLE "sku_option_values" ADD CONSTRAINT "sku_option_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_option_values" ADD CONSTRAINT "sku_option_values_sku_id_company_id_fkey" FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_option_values" ADD CONSTRAINT "sku_option_values_option_id_company_id_fkey" FOREIGN KEY ("option_id", "company_id") REFERENCES "variant_options"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_option_values" ADD CONSTRAINT "sku_option_values_option_value_id_option_id_fkey" FOREIGN KEY ("option_value_id", "option_id") REFERENCES "variant_option_values"("id", "option_id") ON DELETE RESTRICT ON UPDATE CASCADE;
