-- Phase 3.7: Batch / Lot identity + GRN item batch allocations (not inventory balance).

CREATE TABLE "batch_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "batch_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "batch_sequences"
  ADD CONSTRAINT "batch_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "batch_number" TEXT NOT NULL,
    "supplier_batch_number" TEXT,
    "manufactured_at" DATE,
    "expires_at" DATE,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "batches_id_company_id_key" ON "batches"("id", "company_id");
CREATE UNIQUE INDEX "batches_company_id_batch_number_key" ON "batches"("company_id", "batch_number");
CREATE INDEX "batches_company_id_sku_id_idx" ON "batches"("company_id", "sku_id");
CREATE INDEX "batches_company_id_expires_at_idx" ON "batches"("company_id", "expires_at");
CREATE INDEX "batches_company_id_sku_id_supplier_batch_number_idx"
  ON "batches"("company_id", "sku_id", "supplier_batch_number");

-- Same non-null supplier batch text for the same SKU resolves to one Batch identity.
CREATE UNIQUE INDEX "batches_company_sku_supplier_batch_unique"
  ON "batches"("company_id", "sku_id", "supplier_batch_number")
  WHERE "supplier_batch_number" IS NOT NULL;

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "batches"
  ADD CONSTRAINT "batches_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "goods_receipt_item_batches" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "goods_receipt_item_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "goods_receipt_item_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_item_batches_quantity_positive"
      CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "goods_receipt_item_batches_id_company_id_key"
  ON "goods_receipt_item_batches"("id", "company_id");
CREATE UNIQUE INDEX "goods_receipt_item_batches_goods_receipt_item_id_batch_id_key"
  ON "goods_receipt_item_batches"("goods_receipt_item_id", "batch_id");
CREATE INDEX "goods_receipt_item_batches_batch_id_idx"
  ON "goods_receipt_item_batches"("batch_id");
CREATE INDEX "goods_receipt_item_batches_company_id_goods_receipt_item_id_idx"
  ON "goods_receipt_item_batches"("company_id", "goods_receipt_item_id");
CREATE INDEX "goods_receipt_item_batches_company_id_batch_id_idx"
  ON "goods_receipt_item_batches"("company_id", "batch_id");

ALTER TABLE "goods_receipt_item_batches"
  ADD CONSTRAINT "goods_receipt_item_batches_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_item_batches"
  ADD CONSTRAINT "goods_receipt_item_batches_goods_receipt_item_id_company_id_fkey"
  FOREIGN KEY ("goods_receipt_item_id", "company_id")
  REFERENCES "goods_receipt_items"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_item_batches"
  ADD CONSTRAINT "goods_receipt_item_batches_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_item_batches"
  ADD CONSTRAINT "goods_receipt_item_batches_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
