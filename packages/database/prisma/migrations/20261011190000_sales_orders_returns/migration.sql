-- Phase 5.2 — Sales Orders + Wholesale + Lifecycle + Cancellation / Returns
-- Commercial facts only. No reservation / fulfillment / FIFO / receivables.

CREATE TYPE "sales_order_status" AS ENUM (
  'DRAFT',
  'CONFIRMED',
  'PROCESSING',
  'PARTIALLY_FULFILLED',
  'FULFILLED',
  'CANCELLED'
);

CREATE TYPE "sales_order_payment_term_type" AS ENUM ('CASH', 'CREDIT', 'PARTIAL');

CREATE TYPE "sales_order_source" AS ENUM ('MANUAL', 'IMPORT', 'API', 'SYSTEM');

CREATE TYPE "sales_order_cancel_reason" AS ENUM (
  'CUSTOMER_REQUEST',
  'OUT_OF_STOCK',
  'PRICE_ERROR',
  'DUPLICATE_ORDER',
  'CHANNEL_CANCELLED',
  'MANUAL',
  'OTHER'
);

CREATE TYPE "sales_return_status" AS ENUM ('DRAFT', 'APPROVED', 'RECEIVED', 'CANCELLED');

CREATE TYPE "sales_return_reason" AS ENUM (
  'CUSTOMER_REQUEST',
  'WRONG_ITEM',
  'DAMAGED',
  'DEFECTIVE',
  'QUALITY_ISSUE',
  'OTHER'
);

CREATE TYPE "sales_return_condition" AS ENUM (
  'SELLABLE',
  'DAMAGED',
  'QUARANTINE',
  'UNKNOWN'
);

CREATE TABLE "sales_order_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_order_sequences_pkey" PRIMARY KEY ("company_id")
);

CREATE TABLE "sales_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "channel_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "sales_order_status" NOT NULL DEFAULT 'DRAFT',
    "currency" "currency_code" NOT NULL,
    "payment_term_type" "sales_order_payment_term_type" NOT NULL,
    "due_date" TIMESTAMPTZ(3),
    "expected_upfront_amount" DECIMAL(24,6),
    "source" "sales_order_source" NOT NULL DEFAULT 'MANUAL',
    "external_order_id" TEXT,
    "external_reference" TEXT,
    "customer_name_snapshot" TEXT,
    "customer_phone_snapshot" TEXT,
    "shipping_address_snapshot" TEXT,
    "billing_address_snapshot" TEXT,
    "subtotal" DECIMAL(24,6) NOT NULL,
    "item_discount_total" DECIMAL(24,6) NOT NULL,
    "order_discount_total" DECIMAL(24,6) NOT NULL,
    "net_items_total" DECIMAL(24,6) NOT NULL,
    "shipping_amount" DECIMAL(24,6) NOT NULL,
    "other_charges" DECIMAL(24,6) NOT NULL,
    "grand_total" DECIMAL(24,6) NOT NULL,
    "notes" TEXT,
    "ordered_at" TIMESTAMPTZ(3),
    "confirmed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" "sales_order_cancel_reason",
    "cancel_notes" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(24,6) NOT NULL,
    "discount_amount" DECIMAL(24,6) NOT NULL,
    "line_subtotal" DECIMAL(24,6) NOT NULL,
    "line_net_total" DECIMAL(24,6) NOT NULL,
    "cancelled_quantity" INTEGER NOT NULL DEFAULT 0,
    "returned_quantity" INTEGER NOT NULL DEFAULT 0,
    "sku_code_snapshot" TEXT,
    "product_name_snapshot" TEXT,
    "variant_name_snapshot" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_order_items_qty_check" CHECK ("quantity" > 0),
    CONSTRAINT "sales_order_items_cancelled_qty_check" CHECK (
      "cancelled_quantity" >= 0 AND "cancelled_quantity" <= "quantity"
    ),
    CONSTRAINT "sales_order_items_returned_qty_check" CHECK ("returned_quantity" >= 0)
);

CREATE TABLE "sales_return_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sales_return_sequences_pkey" PRIMARY KEY ("company_id")
);

CREATE TABLE "sales_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "return_number" TEXT NOT NULL,
    "sales_order_id" UUID NOT NULL,
    "customer_id" UUID,
    "status" "sales_return_status" NOT NULL DEFAULT 'DRAFT',
    "reason" "sales_return_reason",
    "condition" "sales_return_condition",
    "notes" TEXT,
    "request_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_returns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "sales_return_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "sales_return_id" UUID NOT NULL,
    "sales_order_item_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" "sales_return_reason",
    "condition" "sales_return_condition",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_return_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_return_items_qty_check" CHECK ("quantity" > 0)
);

-- Sequences FKs
ALTER TABLE "sales_order_sequences"
  ADD CONSTRAINT "sales_order_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_return_sequences"
  ADD CONSTRAINT "sales_return_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales orders indexes + FKs
CREATE UNIQUE INDEX "sales_orders_id_company_id_key" ON "sales_orders"("id", "company_id");
CREATE UNIQUE INDEX "sales_orders_company_id_order_number_key" ON "sales_orders"("company_id", "order_number");
CREATE UNIQUE INDEX "sales_orders_company_channel_external_order_id_key"
  ON "sales_orders"("company_id", "channel_id", "external_order_id")
  WHERE "external_order_id" IS NOT NULL;
CREATE INDEX "sales_orders_company_id_status_idx" ON "sales_orders"("company_id", "status");
CREATE INDEX "sales_orders_company_id_channel_id_idx" ON "sales_orders"("company_id", "channel_id");
CREATE INDEX "sales_orders_company_id_customer_id_idx" ON "sales_orders"("company_id", "customer_id");
CREATE INDEX "sales_orders_company_id_ordered_at_idx" ON "sales_orders"("company_id", "ordered_at");
CREATE INDEX "sales_orders_company_id_created_at_idx" ON "sales_orders"("company_id", "created_at");
CREATE INDEX "sales_orders_company_id_request_id_idx" ON "sales_orders"("company_id", "request_id");
CREATE INDEX "sales_orders_company_id_channel_id_external_order_id_idx"
  ON "sales_orders"("company_id", "channel_id", "external_order_id");

ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_channel_id_company_id_fkey"
  FOREIGN KEY ("channel_id", "company_id") REFERENCES "sales_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_customer_id_company_id_fkey"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales order items
CREATE UNIQUE INDEX "sales_order_items_id_company_id_key" ON "sales_order_items"("id", "company_id");
CREATE INDEX "sales_order_items_company_id_sales_order_id_idx" ON "sales_order_items"("company_id", "sales_order_id");
CREATE INDEX "sales_order_items_company_id_sku_id_idx" ON "sales_order_items"("company_id", "sku_id");
CREATE INDEX "sales_order_items_sales_order_id_sku_id_idx" ON "sales_order_items"("sales_order_id", "sku_id");

ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_sales_order_id_company_id_fkey"
  FOREIGN KEY ("sales_order_id", "company_id") REFERENCES "sales_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_order_items"
  ADD CONSTRAINT "sales_order_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales returns
CREATE UNIQUE INDEX "sales_returns_id_company_id_key" ON "sales_returns"("id", "company_id");
CREATE UNIQUE INDEX "sales_returns_company_id_return_number_key" ON "sales_returns"("company_id", "return_number");
CREATE INDEX "sales_returns_company_id_status_idx" ON "sales_returns"("company_id", "status");
CREATE INDEX "sales_returns_company_id_sales_order_id_idx" ON "sales_returns"("company_id", "sales_order_id");
CREATE INDEX "sales_returns_company_id_customer_id_idx" ON "sales_returns"("company_id", "customer_id");
CREATE INDEX "sales_returns_company_id_request_id_idx" ON "sales_returns"("company_id", "request_id");

ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_sales_order_id_company_id_fkey"
  FOREIGN KEY ("sales_order_id", "company_id") REFERENCES "sales_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_customer_id_company_id_fkey"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_returns"
  ADD CONSTRAINT "sales_returns_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Sales return items
CREATE UNIQUE INDEX "sales_return_items_id_company_id_key" ON "sales_return_items"("id", "company_id");
CREATE INDEX "sales_return_items_company_id_sales_return_id_idx" ON "sales_return_items"("company_id", "sales_return_id");
CREATE INDEX "sales_return_items_company_id_sales_order_item_id_idx" ON "sales_return_items"("company_id", "sales_order_item_id");
CREATE INDEX "sales_return_items_company_id_sku_id_idx" ON "sales_return_items"("company_id", "sku_id");

ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_sales_return_id_company_id_fkey"
  FOREIGN KEY ("sales_return_id", "company_id") REFERENCES "sales_returns"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_sales_order_item_id_company_id_fkey"
  FOREIGN KEY ("sales_order_item_id", "company_id") REFERENCES "sales_order_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales_return_items"
  ADD CONSTRAINT "sales_return_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
