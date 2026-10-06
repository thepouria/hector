-- Phase 1.6 Product Attributes
-- Attribute values are ALWAYS optional. No DB constraint requires Product/SKU attribute rows.

CREATE TYPE "attribute_type" AS ENUM ('TEXT', 'NUMBER', 'BOOLEAN', 'SINGLE_SELECT', 'MULTI_SELECT');
CREATE TYPE "attribute_scope" AS ENUM ('PRODUCT', 'SKU', 'BOTH');

CREATE TABLE "attribute_definitions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "normalized_code" TEXT NOT NULL,
    "type" "attribute_type" NOT NULL,
    "scope" "attribute_scope" NOT NULL DEFAULT 'PRODUCT',
    "unit" TEXT,
    "description" TEXT,
    "status" "catalog_lifecycle_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "attribute_options" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "attribute_definition_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "normalized_value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "attribute_options_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "category_attributes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "attribute_definition_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_attributes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_attribute_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "attribute_definition_id" UUID NOT NULL,
    "text_value" TEXT,
    "number_value" DECIMAL(18,6),
    "boolean_value" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_attribute_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "product_attribute_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_attribute_value_id" UUID NOT NULL,
    "attribute_option_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_attribute_selections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sku_attribute_values" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "attribute_definition_id" UUID NOT NULL,
    "text_value" TEXT,
    "number_value" DECIMAL(18,6),
    "boolean_value" BOOLEAN,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sku_attribute_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sku_attribute_selections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sku_attribute_value_id" UUID NOT NULL,
    "attribute_option_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sku_attribute_selections_pkey" PRIMARY KEY ("id")
);

-- AttributeDefinition indexes / uniques
CREATE UNIQUE INDEX "attribute_definitions_id_company_id_key" ON "attribute_definitions"("id", "company_id");
CREATE UNIQUE INDEX "attribute_definitions_company_id_normalized_code_key" ON "attribute_definitions"("company_id", "normalized_code");
CREATE INDEX "attribute_definitions_company_id_normalized_name_idx" ON "attribute_definitions"("company_id", "normalized_name");
CREATE INDEX "attribute_definitions_company_id_type_idx" ON "attribute_definitions"("company_id", "type");
CREATE INDEX "attribute_definitions_company_id_scope_idx" ON "attribute_definitions"("company_id", "scope");
CREATE INDEX "attribute_definitions_company_id_status_idx" ON "attribute_definitions"("company_id", "status");

-- AttributeOption
CREATE UNIQUE INDEX "attribute_options_id_company_id_key" ON "attribute_options"("id", "company_id");
CREATE UNIQUE INDEX "attribute_options_id_attribute_definition_id_key" ON "attribute_options"("id", "attribute_definition_id");
CREATE UNIQUE INDEX "attribute_options_attribute_definition_id_normalized_value_key" ON "attribute_options"("attribute_definition_id", "normalized_value");
CREATE INDEX "attribute_options_attribute_definition_id_position_idx" ON "attribute_options"("attribute_definition_id", "position");
CREATE INDEX "attribute_options_company_id_attribute_definition_id_idx" ON "attribute_options"("company_id", "attribute_definition_id");

-- CategoryAttribute
CREATE UNIQUE INDEX "category_attributes_category_id_attribute_definition_id_key" ON "category_attributes"("category_id", "attribute_definition_id");
CREATE INDEX "category_attributes_category_id_position_idx" ON "category_attributes"("category_id", "position");
CREATE INDEX "category_attributes_attribute_definition_id_idx" ON "category_attributes"("attribute_definition_id");
CREATE INDEX "category_attributes_company_id_category_id_idx" ON "category_attributes"("company_id", "category_id");

-- ProductAttributeValue
CREATE UNIQUE INDEX "product_attribute_values_product_id_attribute_definition_id_key" ON "product_attribute_values"("product_id", "attribute_definition_id");
CREATE INDEX "product_attribute_values_attribute_definition_id_idx" ON "product_attribute_values"("attribute_definition_id");
CREATE INDEX "product_attribute_values_company_id_product_id_idx" ON "product_attribute_values"("company_id", "product_id");

-- ProductAttributeSelection
CREATE UNIQUE INDEX "product_attribute_selections_product_attribute_value_id_attribute_option_id_key" ON "product_attribute_selections"("product_attribute_value_id", "attribute_option_id");
CREATE INDEX "product_attribute_selections_attribute_option_id_idx" ON "product_attribute_selections"("attribute_option_id");
CREATE INDEX "product_attribute_selections_company_id_product_attribute_value_id_idx" ON "product_attribute_selections"("company_id", "product_attribute_value_id");

-- SkuAttributeValue
CREATE UNIQUE INDEX "sku_attribute_values_sku_id_attribute_definition_id_key" ON "sku_attribute_values"("sku_id", "attribute_definition_id");
CREATE INDEX "sku_attribute_values_attribute_definition_id_idx" ON "sku_attribute_values"("attribute_definition_id");
CREATE INDEX "sku_attribute_values_company_id_sku_id_idx" ON "sku_attribute_values"("company_id", "sku_id");

-- SkuAttributeSelection
CREATE UNIQUE INDEX "sku_attribute_selections_sku_attribute_value_id_attribute_option_id_key" ON "sku_attribute_selections"("sku_attribute_value_id", "attribute_option_id");
CREATE INDEX "sku_attribute_selections_attribute_option_id_idx" ON "sku_attribute_selections"("attribute_option_id");
CREATE INDEX "sku_attribute_selections_company_id_sku_attribute_value_id_idx" ON "sku_attribute_selections"("company_id", "sku_attribute_value_id");

-- Foreign keys
ALTER TABLE "attribute_definitions" ADD CONSTRAINT "attribute_definitions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attribute_options" ADD CONSTRAINT "attribute_options_attribute_definition_id_company_id_fkey" FOREIGN KEY ("attribute_definition_id", "company_id") REFERENCES "attribute_definitions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "categories"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "category_attributes" ADD CONSTRAINT "category_attributes_attribute_definition_id_company_id_fkey" FOREIGN KEY ("attribute_definition_id", "company_id") REFERENCES "attribute_definitions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_attribute_values" ADD CONSTRAINT "product_attribute_values_attribute_definition_id_company_id_fkey" FOREIGN KEY ("attribute_definition_id", "company_id") REFERENCES "attribute_definitions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_attribute_selections" ADD CONSTRAINT "product_attribute_selections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_attribute_selections" ADD CONSTRAINT "product_attribute_selections_product_attribute_value_id_fkey" FOREIGN KEY ("product_attribute_value_id") REFERENCES "product_attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_attribute_selections" ADD CONSTRAINT "product_attribute_selections_attribute_option_id_company_id_fkey" FOREIGN KEY ("attribute_option_id", "company_id") REFERENCES "attribute_options"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sku_attribute_values" ADD CONSTRAINT "sku_attribute_values_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_attribute_values" ADD CONSTRAINT "sku_attribute_values_sku_id_company_id_fkey" FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_attribute_values" ADD CONSTRAINT "sku_attribute_values_attribute_definition_id_company_id_fkey" FOREIGN KEY ("attribute_definition_id", "company_id") REFERENCES "attribute_definitions"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sku_attribute_selections" ADD CONSTRAINT "sku_attribute_selections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sku_attribute_selections" ADD CONSTRAINT "sku_attribute_selections_sku_attribute_value_id_fkey" FOREIGN KEY ("sku_attribute_value_id") REFERENCES "sku_attribute_values"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sku_attribute_selections" ADD CONSTRAINT "sku_attribute_selections_attribute_option_id_company_id_fkey" FOREIGN KEY ("attribute_option_id", "company_id") REFERENCES "attribute_options"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
