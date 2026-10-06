-- Phase 3.14: Supplier Return Execution (physical warehouse fulfillment of PurchaseReturn).

CREATE TYPE "supplier_return_execution_status" AS ENUM (
  'DRAFT',
  'DISPATCHED',
  'CANCELLED'
);

CREATE TABLE "supplier_return_execution_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "supplier_return_execution_sequences_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "supplier_return_execution_sequences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "supplier_return_executions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "purchase_return_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "status" "supplier_return_execution_status" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "dispatched_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "dispatched_by_id" UUID,
  "cancelled_by_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "supplier_return_executions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_return_executions_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "supplier_return_executions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_executions_return_company_fkey"
    FOREIGN KEY ("purchase_return_id", "company_id")
      REFERENCES "purchase_returns"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_executions_warehouse_company_fkey"
    FOREIGN KEY ("warehouse_id", "company_id")
      REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_executions_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_executions_dispatched_by_id_fkey"
    FOREIGN KEY ("dispatched_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_executions_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "supplier_return_executions_id_company_id_key"
  ON "supplier_return_executions"("id", "company_id");
CREATE UNIQUE INDEX "supplier_return_executions_company_id_number_key"
  ON "supplier_return_executions"("company_id", "number");
CREATE INDEX "supplier_return_executions_company_id_status_idx"
  ON "supplier_return_executions"("company_id", "status");
CREATE INDEX "supplier_return_executions_company_id_purchase_return_id_idx"
  ON "supplier_return_executions"("company_id", "purchase_return_id");
CREATE INDEX "supplier_return_executions_company_id_warehouse_id_idx"
  ON "supplier_return_executions"("company_id", "warehouse_id");
CREATE INDEX "supplier_return_executions_company_id_created_at_idx"
  ON "supplier_return_executions"("company_id", "created_at");

CREATE TABLE "supplier_return_execution_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "supplier_return_execution_id" UUID NOT NULL,
  "purchase_return_item_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "classification" "stock_classification" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "supplier_return_execution_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_return_execution_items_quantity_positive"
    CHECK ("quantity" > 0),
  CONSTRAINT "supplier_return_execution_items_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_execution_items_execution_company_fkey"
    FOREIGN KEY ("supplier_return_execution_id", "company_id")
      REFERENCES "supplier_return_executions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_execution_items_return_item_company_fkey"
    FOREIGN KEY ("purchase_return_item_id", "company_id")
      REFERENCES "purchase_return_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_execution_items_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_execution_items_batch_company_fkey"
    FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_execution_items_location_company_fkey"
    FOREIGN KEY ("location_id", "company_id")
      REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "supplier_return_execution_items_id_company_id_key"
  ON "supplier_return_execution_items"("id", "company_id");
CREATE UNIQUE INDEX "supplier_return_execution_items_position_key"
  ON "supplier_return_execution_items"(
    "supplier_return_execution_id",
    "purchase_return_item_id",
    "location_id",
    "sku_id",
    "batch_id",
    "classification"
  );
CREATE INDEX "supplier_return_execution_items_execution_id_idx"
  ON "supplier_return_execution_items"("supplier_return_execution_id");
CREATE INDEX "supplier_return_execution_items_purchase_return_item_id_idx"
  ON "supplier_return_execution_items"("purchase_return_item_id");
CREATE INDEX "supplier_return_execution_items_company_id_sku_id_idx"
  ON "supplier_return_execution_items"("company_id", "sku_id");
CREATE INDEX "supplier_return_execution_items_location_id_idx"
  ON "supplier_return_execution_items"("location_id");
CREATE INDEX "supplier_return_execution_items_batch_id_idx"
  ON "supplier_return_execution_items"("batch_id");
CREATE INDEX "supplier_return_execution_items_classification_idx"
  ON "supplier_return_execution_items"("classification");

CREATE TABLE "supplier_return_execution_scan_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "supplier_return_execution_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "response_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_return_execution_scan_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_return_execution_scan_requests_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "supplier_return_execution_scan_requests_execution_company_fkey"
    FOREIGN KEY ("supplier_return_execution_id", "company_id")
      REFERENCES "supplier_return_executions"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "supplier_return_execution_scan_requests_company_exec_req_key"
  ON "supplier_return_execution_scan_requests"(
    "company_id",
    "supplier_return_execution_id",
    "request_id"
  );
CREATE INDEX "supplier_return_execution_scan_requests_execution_id_idx"
  ON "supplier_return_execution_scan_requests"("supplier_return_execution_id");
