-- Phase 3.11: Internal Stock Transfer + system transit inventory position.

ALTER TYPE "warehouse_location_type" ADD VALUE IF NOT EXISTS 'TRANSIT';

CREATE TYPE "stock_transfer_status" AS ENUM ('DRAFT', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

ALTER TABLE "warehouses"
  ADD COLUMN "is_system" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "warehouses_company_id_is_system_idx" ON "warehouses"("company_id", "is_system");

-- System warehouses cannot be company default.
ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_system_not_default_check"
  CHECK (NOT ("is_system" = true AND "is_default" = true));

CREATE TABLE "stock_transfer_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_transfer_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "stock_transfer_sequences"
  ADD CONSTRAINT "stock_transfer_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "source_warehouse_id" UUID NOT NULL,
    "destination_warehouse_id" UUID NOT NULL,
    "status" "stock_transfer_status" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "external_reference" TEXT,
    "dispatched_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "dispatched_by_id" UUID,
    "completed_by_id" UUID,
    "cancelled_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfers_id_company_id_key" ON "stock_transfers"("id", "company_id");
CREATE UNIQUE INDEX "stock_transfers_company_id_number_key" ON "stock_transfers"("company_id", "number");
CREATE INDEX "stock_transfers_company_id_status_idx" ON "stock_transfers"("company_id", "status");
CREATE INDEX "stock_transfers_company_id_source_warehouse_id_idx" ON "stock_transfers"("company_id", "source_warehouse_id");
CREATE INDEX "stock_transfers_company_id_destination_warehouse_id_idx" ON "stock_transfers"("company_id", "destination_warehouse_id");
CREATE INDEX "stock_transfers_company_id_created_at_idx" ON "stock_transfers"("company_id", "created_at");

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_source_warehouse_id_company_id_fkey"
  FOREIGN KEY ("source_warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_destination_warehouse_id_company_id_fkey"
  FOREIGN KEY ("destination_warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_dispatched_by_id_fkey"
  FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_transfer_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "source_location_id" UUID NOT NULL,
    "destination_location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "complete_source_line_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "cancel_source_line_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "dispatch_operation_id" UUID,
    "complete_operation_id" UUID,
    "cancel_operation_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_transfer_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_transfer_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "stock_transfer_items_locations_distinct" CHECK ("source_location_id" <> "destination_location_id")
);

CREATE UNIQUE INDEX "stock_transfer_items_id_company_id_key" ON "stock_transfer_items"("id", "company_id");
CREATE UNIQUE INDEX "stock_transfer_items_transfer_position_key"
  ON "stock_transfer_items"("transfer_id", "sku_id", "batch_id", "source_location_id", "destination_location_id");
CREATE UNIQUE INDEX "stock_transfer_items_complete_source_line_id_key" ON "stock_transfer_items"("complete_source_line_id");
CREATE UNIQUE INDEX "stock_transfer_items_cancel_source_line_id_key" ON "stock_transfer_items"("cancel_source_line_id");
CREATE INDEX "stock_transfer_items_transfer_id_idx" ON "stock_transfer_items"("transfer_id");
CREATE INDEX "stock_transfer_items_company_id_sku_id_idx" ON "stock_transfer_items"("company_id", "sku_id");
CREATE INDEX "stock_transfer_items_batch_id_idx" ON "stock_transfer_items"("batch_id");
CREATE INDEX "stock_transfer_items_source_location_id_idx" ON "stock_transfer_items"("source_location_id");
CREATE INDEX "stock_transfer_items_destination_location_id_idx" ON "stock_transfer_items"("destination_location_id");

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_transfer_id_company_id_fkey"
  FOREIGN KEY ("transfer_id", "company_id") REFERENCES "stock_transfers"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_source_location_id_company_id_fkey"
  FOREIGN KEY ("source_location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_items"
  ADD CONSTRAINT "stock_transfer_items_destination_location_id_company_id_fkey"
  FOREIGN KEY ("destination_location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_transfer_scan_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_transfer_scan_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_transfer_scan_requests_company_id_transfer_id_request_id_key"
  ON "stock_transfer_scan_requests"("company_id", "transfer_id", "request_id");
CREATE INDEX "stock_transfer_scan_requests_transfer_id_idx" ON "stock_transfer_scan_requests"("transfer_id");

ALTER TABLE "stock_transfer_scan_requests"
  ADD CONSTRAINT "stock_transfer_scan_requests_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfer_scan_requests"
  ADD CONSTRAINT "stock_transfer_scan_requests_transfer_id_company_id_fkey"
  FOREIGN KEY ("transfer_id", "company_id") REFERENCES "stock_transfers"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
