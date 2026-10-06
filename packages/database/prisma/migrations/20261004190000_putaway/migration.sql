-- Phase 3.8: Putaway sessions + items (historical placement; not InventoryMovement / StockBalance).

CREATE TYPE "putaway_status" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

CREATE TABLE "putaway_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "putaway_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "putaway_sequences"
  ADD CONSTRAINT "putaway_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "putaways" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "status" "putaway_status" NOT NULL DEFAULT 'DRAFT',
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "completed_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "putaways_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "putaways_id_company_id_key" ON "putaways"("id", "company_id");
CREATE UNIQUE INDEX "putaways_company_id_number_key" ON "putaways"("company_id", "number");
CREATE INDEX "putaways_company_id_status_idx" ON "putaways"("company_id", "status");
CREATE INDEX "putaways_company_id_warehouse_id_idx" ON "putaways"("company_id", "warehouse_id");
CREATE INDEX "putaways_company_id_goods_receipt_id_idx" ON "putaways"("company_id", "goods_receipt_id");
CREATE INDEX "putaways_company_id_created_at_idx" ON "putaways"("company_id", "created_at");

ALTER TABLE "putaways"
  ADD CONSTRAINT "putaways_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaways"
  ADD CONSTRAINT "putaways_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaways"
  ADD CONSTRAINT "putaways_goods_receipt_id_company_id_fkey"
  FOREIGN KEY ("goods_receipt_id", "company_id") REFERENCES "goods_receipts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaways"
  ADD CONSTRAINT "putaways_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaways"
  ADD CONSTRAINT "putaways_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "putaway_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "putaway_id" UUID NOT NULL,
    "goods_receipt_item_batch_id" UUID NOT NULL,
    "warehouse_location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "putaway_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "putaway_items_quantity_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "putaway_items_id_company_id_key" ON "putaway_items"("id", "company_id");
CREATE UNIQUE INDEX "putaway_items_putaway_allocation_location_key"
  ON "putaway_items"("putaway_id", "goods_receipt_item_batch_id", "warehouse_location_id");
CREATE INDEX "putaway_items_putaway_id_idx" ON "putaway_items"("putaway_id");
CREATE INDEX "putaway_items_goods_receipt_item_batch_id_idx" ON "putaway_items"("goods_receipt_item_batch_id");
CREATE INDEX "putaway_items_warehouse_location_id_idx" ON "putaway_items"("warehouse_location_id");
CREATE INDEX "putaway_items_company_id_putaway_id_idx" ON "putaway_items"("company_id", "putaway_id");

ALTER TABLE "putaway_items"
  ADD CONSTRAINT "putaway_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaway_items"
  ADD CONSTRAINT "putaway_items_putaway_id_company_id_fkey"
  FOREIGN KEY ("putaway_id", "company_id") REFERENCES "putaways"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "putaway_items"
  ADD CONSTRAINT "putaway_items_goods_receipt_item_batch_id_company_id_fkey"
  FOREIGN KEY ("goods_receipt_item_batch_id", "company_id")
  REFERENCES "goods_receipt_item_batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaway_items"
  ADD CONSTRAINT "putaway_items_warehouse_location_id_company_id_fkey"
  FOREIGN KEY ("warehouse_location_id", "company_id")
  REFERENCES "warehouse_locations"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "putaway_scan_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "putaway_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "putaway_scan_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "putaway_scan_requests_company_putaway_request_key"
  ON "putaway_scan_requests"("company_id", "putaway_id", "request_id");
CREATE INDEX "putaway_scan_requests_putaway_id_idx" ON "putaway_scan_requests"("putaway_id");

ALTER TABLE "putaway_scan_requests"
  ADD CONSTRAINT "putaway_scan_requests_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "putaway_scan_requests"
  ADD CONSTRAINT "putaway_scan_requests_putaway_id_company_id_fkey"
  FOREIGN KEY ("putaway_id", "company_id") REFERENCES "putaways"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
