-- CreateEnum
CREATE TYPE "catalog_lifecycle_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "barcode_type" AS ENUM ('EAN13', 'EAN8', 'UPC', 'INTERNAL', 'OTHER');

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "status" "catalog_lifecycle_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parent_id" UUID,
    "status" "catalog_lifecycle_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "brand_id" UUID,
    "category_id" UUID,
    "status" "catalog_lifecycle_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skus" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "status" "catalog_lifecycle_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barcodes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "type" "barcode_type" NOT NULL DEFAULT 'OTHER',
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "barcodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brands_company_id_status_idx" ON "brands"("company_id", "status");

-- CreateIndex
CREATE INDEX "brands_company_id_name_idx" ON "brands"("company_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_id_company_id_key" ON "brands"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_company_id_code_key" ON "brands"("company_id", "code");

-- CreateIndex
CREATE INDEX "categories_company_id_status_idx" ON "categories"("company_id", "status");

-- CreateIndex
CREATE INDEX "categories_company_id_name_idx" ON "categories"("company_id", "name");

-- CreateIndex
CREATE INDEX "categories_company_id_parent_id_idx" ON "categories"("company_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_id_company_id_key" ON "categories"("id", "company_id");

-- CreateIndex
CREATE INDEX "products_company_id_status_idx" ON "products"("company_id", "status");

-- CreateIndex
CREATE INDEX "products_company_id_name_idx" ON "products"("company_id", "name");

-- CreateIndex
CREATE INDEX "products_company_id_brand_id_idx" ON "products"("company_id", "brand_id");

-- CreateIndex
CREATE INDEX "products_company_id_category_id_idx" ON "products"("company_id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_company_id_key" ON "products"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_company_id_code_key" ON "products"("company_id", "code");

-- CreateIndex
CREATE INDEX "skus_company_id_status_idx" ON "skus"("company_id", "status");

-- CreateIndex
CREATE INDEX "skus_product_id_idx" ON "skus"("product_id");

-- CreateIndex
CREATE INDEX "skus_company_id_product_id_idx" ON "skus"("company_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_id_company_id_key" ON "skus"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "skus_company_id_code_key" ON "skus"("company_id", "code");

-- CreateIndex
CREATE INDEX "barcodes_sku_id_idx" ON "barcodes"("sku_id");

-- CreateIndex
CREATE INDEX "barcodes_company_id_sku_id_idx" ON "barcodes"("company_id", "sku_id");

-- CreateIndex
CREATE UNIQUE INDEX "barcodes_company_id_value_key" ON "barcodes"("company_id", "value");

-- At most one primary barcode per SKU (partial unique index — not expressible in Prisma schema alone).
CREATE UNIQUE INDEX "barcodes_one_primary_per_sku"
ON "barcodes" ("sku_id")
WHERE "is_primary" = true;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_company_id_fkey" FOREIGN KEY ("parent_id", "company_id") REFERENCES "categories"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_company_id_fkey" FOREIGN KEY ("brand_id", "company_id") REFERENCES "brands"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_company_id_fkey" FOREIGN KEY ("category_id", "company_id") REFERENCES "categories"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skus" ADD CONSTRAINT "skus_product_id_company_id_fkey" FOREIGN KEY ("product_id", "company_id") REFERENCES "products"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "barcodes" ADD CONSTRAINT "barcodes_sku_id_company_id_fkey" FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
