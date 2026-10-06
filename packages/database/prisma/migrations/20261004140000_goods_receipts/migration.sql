-- Phase 3.4 Goods Receipt Core (GRN header + items). No inventory movements / stock.

CREATE TYPE "goods_receipt_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

CREATE TABLE "goods_receipt_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "goods_receipt_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "goods_receipt_sequences"
  ADD CONSTRAINT "goods_receipt_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "status" "goods_receipt_status" NOT NULL DEFAULT 'DRAFT',
    "received_at" TIMESTAMPTZ(3),
    "posted_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "cancellation_reason" TEXT,
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipts_posted_requires_posted_at_check"
      CHECK (
        ("status" <> 'POSTED') OR ("posted_at" IS NOT NULL AND "posted_by_id" IS NOT NULL)
      ),
    CONSTRAINT "goods_receipts_cancelled_requires_cancelled_at_check"
      CHECK (
        ("status" <> 'CANCELLED') OR ("cancelled_at" IS NOT NULL)
      )
);

CREATE UNIQUE INDEX "goods_receipts_id_company_id_key"
  ON "goods_receipts"("id", "company_id");

CREATE UNIQUE INDEX "goods_receipts_company_id_number_key"
  ON "goods_receipts"("company_id", "number");

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_warehouse_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_purchase_order_company_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id") REFERENCES "purchase_orders"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_supplier_company_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "goods_receipts_company_id_status_idx"
  ON "goods_receipts"("company_id", "status");

CREATE INDEX "goods_receipts_company_id_warehouse_id_idx"
  ON "goods_receipts"("company_id", "warehouse_id");

CREATE INDEX "goods_receipts_company_id_purchase_order_id_idx"
  ON "goods_receipts"("company_id", "purchase_order_id");

CREATE INDEX "goods_receipts_company_id_supplier_id_idx"
  ON "goods_receipts"("company_id", "supplier_id");

CREATE INDEX "goods_receipts_purchase_order_id_status_idx"
  ON "goods_receipts"("purchase_order_id", "status");

CREATE INDEX "goods_receipts_company_id_received_at_idx"
  ON "goods_receipts"("company_id", "received_at");

CREATE INDEX "goods_receipts_company_id_created_at_idx"
  ON "goods_receipts"("company_id", "created_at");

CREATE TABLE "goods_receipt_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "goods_receipt_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_items_quantity_positive_check"
      CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "goods_receipt_items_id_company_id_key"
  ON "goods_receipt_items"("id", "company_id");

CREATE UNIQUE INDEX "goods_receipt_items_goods_receipt_id_purchase_order_item_id_key"
  ON "goods_receipt_items"("goods_receipt_id", "purchase_order_item_id");

ALTER TABLE "goods_receipt_items"
  ADD CONSTRAINT "goods_receipt_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_items"
  ADD CONSTRAINT "goods_receipt_items_receipt_company_fkey"
  FOREIGN KEY ("goods_receipt_id", "company_id") REFERENCES "goods_receipts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_items"
  ADD CONSTRAINT "goods_receipt_items_po_item_company_fkey"
  FOREIGN KEY ("purchase_order_item_id", "company_id") REFERENCES "purchase_order_items"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_items"
  ADD CONSTRAINT "goods_receipt_items_sku_company_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "goods_receipt_items_company_id_goods_receipt_id_idx"
  ON "goods_receipt_items"("company_id", "goods_receipt_id");

CREATE INDEX "goods_receipt_items_purchase_order_item_id_idx"
  ON "goods_receipt_items"("purchase_order_item_id");

CREATE INDEX "goods_receipt_items_company_id_sku_id_idx"
  ON "goods_receipt_items"("company_id", "sku_id");
