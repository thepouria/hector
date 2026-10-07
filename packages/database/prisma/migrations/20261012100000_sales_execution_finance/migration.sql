-- Phase 5.3 — Sales Execution + Finance AR foundation
-- Reservation / Fulfillment / FIFO ISSUE / Customer Receivable / Return RECEIVED

CREATE TYPE "sales_fulfillment_status" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

CREATE TYPE "customer_receivable_counterparty_type" AS ENUM ('CUSTOMER', 'CHANNEL');

CREATE TYPE "customer_receivable_status" AS ENUM (
  'OPEN',
  'PARTIALLY_SETTLED',
  'SETTLED',
  'CANCELLED',
  'CREDITED'
);

-- Sales order item: physical fulfillment tracker
ALTER TABLE "sales_order_items"
  ADD COLUMN "fulfilled_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_fulfilled_qty_check" CHECK (
    "fulfilled_quantity" >= 0 AND "fulfilled_quantity" <= "quantity"
  );

-- Sales return: physical receive fields
ALTER TABLE "sales_returns"
  ADD COLUMN "received_at" TIMESTAMPTZ(3),
  ADD COLUMN "warehouse_id" UUID,
  ADD COLUMN "received_by_id" UUID;

-- Sales return items: physical receive dimensions
ALTER TABLE "sales_return_items"
  ADD COLUMN "location_id" UUID,
  ADD COLUMN "batch_id" UUID,
  ADD COLUMN "classification" "stock_classification";

-- Sequences
CREATE TABLE "sales_fulfillment_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_fulfillment_sequences_pkey" PRIMARY KEY ("company_id")
);

CREATE TABLE "customer_receivable_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "customer_receivable_sequences_pkey" PRIMARY KEY ("company_id")
);

CREATE TABLE "sales_fulfillments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "fulfillment_number" TEXT NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "status" "sales_fulfillment_status" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "request_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "completed_by_id" UUID,
    "cancelled_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_fulfillments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_fulfillment_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sales_fulfillment_id" UUID NOT NULL,
    "sales_order_item_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "classification" "stock_classification" NOT NULL DEFAULT 'SELLABLE',
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_fulfillment_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_fulfillment_items_qty_check" CHECK ("quantity" > 0)
);

CREATE TABLE "customer_receivables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "counterparty_type" "customer_receivable_counterparty_type" NOT NULL,
    "customer_id" UUID,
    "channel_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "sales_fulfillment_id" UUID,
    "sales_return_id" UUID,
    "currency" "currency_code" NOT NULL,
    "amount" DECIMAL(24,6) NOT NULL,
    "due_date" TIMESTAMPTZ(3),
    "status" "customer_receivable_status" NOT NULL DEFAULT 'OPEN',
    "recognized_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "request_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_receivables_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_receivable_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "receivable_id" UUID NOT NULL,
    "sales_order_item_id" UUID,
    "sales_fulfillment_item_id" UUID,
    "sku_id" UUID,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(24,6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_receivable_lines_pkey" PRIMARY KEY ("id")
);

-- Sequence FKs
ALTER TABLE "sales_fulfillment_sequences"
  ADD CONSTRAINT "sales_fulfillment_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_receivable_sequences"
  ADD CONSTRAINT "customer_receivable_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales fulfillments indexes + FKs
CREATE UNIQUE INDEX "sales_fulfillments_id_company_id_key"
  ON "sales_fulfillments"("id", "company_id");
CREATE UNIQUE INDEX "sales_fulfillments_company_id_fulfillment_number_key"
  ON "sales_fulfillments"("company_id", "fulfillment_number");
CREATE UNIQUE INDEX "sales_fulfillments_company_id_request_id_key"
  ON "sales_fulfillments"("company_id", "request_id");
CREATE INDEX "sales_fulfillments_company_id_sales_order_id_idx"
  ON "sales_fulfillments"("company_id", "sales_order_id");
CREATE INDEX "sales_fulfillments_company_id_status_idx"
  ON "sales_fulfillments"("company_id", "status");
CREATE INDEX "sales_fulfillments_company_id_warehouse_id_idx"
  ON "sales_fulfillments"("company_id", "warehouse_id");
CREATE INDEX "sales_fulfillments_company_id_created_at_idx"
  ON "sales_fulfillments"("company_id", "created_at");

ALTER TABLE "sales_fulfillments"
  ADD CONSTRAINT "sales_fulfillments_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillments"
  ADD CONSTRAINT "sales_fulfillments_sales_order_id_company_id_fkey"
  FOREIGN KEY ("sales_order_id", "company_id") REFERENCES "sales_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillments"
  ADD CONSTRAINT "sales_fulfillments_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillments"
  ADD CONSTRAINT "sales_fulfillments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillments"
  ADD CONSTRAINT "sales_fulfillments_completed_by_id_fkey"
  FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillments"
  ADD CONSTRAINT "sales_fulfillments_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales fulfillment items
CREATE UNIQUE INDEX "sales_fulfillment_items_id_company_id_key"
  ON "sales_fulfillment_items"("id", "company_id");
CREATE INDEX "sales_fulfillment_items_company_id_sales_fulfillment_id_idx"
  ON "sales_fulfillment_items"("company_id", "sales_fulfillment_id");
CREATE INDEX "sales_fulfillment_items_company_id_sales_order_item_id_idx"
  ON "sales_fulfillment_items"("company_id", "sales_order_item_id");
CREATE INDEX "sales_fulfillment_items_company_id_sku_id_idx"
  ON "sales_fulfillment_items"("company_id", "sku_id");

ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_sales_fulfillment_id_company_id_fkey"
  FOREIGN KEY ("sales_fulfillment_id", "company_id") REFERENCES "sales_fulfillments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_sales_order_item_id_company_id_fkey"
  FOREIGN KEY ("sales_order_item_id", "company_id") REFERENCES "sales_order_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_location_id_company_id_fkey"
  FOREIGN KEY ("location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_fulfillment_items"
  ADD CONSTRAINT "sales_fulfillment_items_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customer receivables
CREATE UNIQUE INDEX "customer_receivables_id_company_id_key"
  ON "customer_receivables"("id", "company_id");
CREATE UNIQUE INDEX "customer_receivables_company_id_number_key"
  ON "customer_receivables"("company_id", "number");
CREATE UNIQUE INDEX "customer_receivables_sales_fulfillment_id_company_id_key"
  ON "customer_receivables"("sales_fulfillment_id", "company_id");
CREATE UNIQUE INDEX "customer_receivables_sales_return_id_company_id_key"
  ON "customer_receivables"("sales_return_id", "company_id");
CREATE UNIQUE INDEX "customer_receivables_company_id_request_id_key"
  ON "customer_receivables"("company_id", "request_id");
CREATE INDEX "customer_receivables_company_id_status_idx"
  ON "customer_receivables"("company_id", "status");
CREATE INDEX "customer_receivables_company_id_customer_id_idx"
  ON "customer_receivables"("company_id", "customer_id");
CREATE INDEX "customer_receivables_company_id_channel_id_idx"
  ON "customer_receivables"("company_id", "channel_id");
CREATE INDEX "customer_receivables_company_id_sales_order_id_idx"
  ON "customer_receivables"("company_id", "sales_order_id");
CREATE INDEX "customer_receivables_company_id_recognized_at_idx"
  ON "customer_receivables"("company_id", "recognized_at");

ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_customer_id_company_id_fkey"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_channel_id_company_id_fkey"
  FOREIGN KEY ("channel_id", "company_id") REFERENCES "sales_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_sales_order_id_company_id_fkey"
  FOREIGN KEY ("sales_order_id", "company_id") REFERENCES "sales_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_sales_fulfillment_id_company_id_fkey"
  FOREIGN KEY ("sales_fulfillment_id", "company_id") REFERENCES "sales_fulfillments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_sales_return_id_company_id_fkey"
  FOREIGN KEY ("sales_return_id", "company_id") REFERENCES "sales_returns"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivables"
  ADD CONSTRAINT "customer_receivables_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Customer receivable lines
CREATE UNIQUE INDEX "customer_receivable_lines_id_company_id_key"
  ON "customer_receivable_lines"("id", "company_id");
CREATE INDEX "customer_receivable_lines_company_id_receivable_id_idx"
  ON "customer_receivable_lines"("company_id", "receivable_id");
CREATE INDEX "customer_receivable_lines_company_id_sales_order_item_id_idx"
  ON "customer_receivable_lines"("company_id", "sales_order_item_id");

ALTER TABLE "customer_receivable_lines"
  ADD CONSTRAINT "customer_receivable_lines_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivable_lines"
  ADD CONSTRAINT "customer_receivable_lines_receivable_id_company_id_fkey"
  FOREIGN KEY ("receivable_id", "company_id") REFERENCES "customer_receivables"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivable_lines"
  ADD CONSTRAINT "customer_receivable_lines_sales_order_item_id_company_id_fkey"
  FOREIGN KEY ("sales_order_item_id", "company_id") REFERENCES "sales_order_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivable_lines"
  ADD CONSTRAINT "customer_receivable_lines_sales_fulfillment_item_id_company_id_fkey"
  FOREIGN KEY ("sales_fulfillment_item_id", "company_id") REFERENCES "sales_fulfillment_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "customer_receivable_lines"
  ADD CONSTRAINT "customer_receivable_lines_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales return physical receive FKs
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_received_by_id_fkey"
  FOREIGN KEY ("received_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_location_id_company_id_fkey"
  FOREIGN KEY ("location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
