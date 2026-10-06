-- Phase 2.11 — Purchase Returns / Corrections / Discrepancies
-- Commercial Purchasing records only. No Warehouse stock / Finance refunds.

CREATE TYPE "purchase_correction_type" AS ENUM (
  'DATA_ENTRY_ERROR',
  'QUANTITY_CORRECTION',
  'PRICE_CORRECTION',
  'COMMERCIAL_TERM_CORRECTION',
  'SUPPLIER_CORRECTION',
  'OTHER'
);

CREATE TYPE "purchase_correction_status" AS ENUM ('APPLIED');

CREATE TYPE "purchase_discrepancy_type" AS ENUM (
  'SHORT_SHIPMENT',
  'OVER_SHIPMENT',
  'DAMAGED',
  'WRONG_ITEM',
  'MISSING',
  'OTHER'
);

CREATE TYPE "purchase_discrepancy_source" AS ENUM (
  'BEFORE_RECEIPT',
  'AT_RECEIPT',
  'AFTER_RECEIPT'
);

CREATE TYPE "purchase_discrepancy_status" AS ENUM (
  'OPEN',
  'RESOLVED',
  'SHORT_CLOSED'
);

CREATE TYPE "purchase_return_status" AS ENUM (
  'DRAFT',
  'APPROVED',
  'CANCELLED'
);

CREATE TYPE "purchase_return_reason" AS ENUM (
  'DAMAGED',
  'DEFECTIVE',
  'WRONG_ITEM',
  'OVER_SHIPMENT',
  'QUALITY_ISSUE',
  'EXPIRED',
  'SUPPLIER_AGREEMENT',
  'OTHER'
);

CREATE TYPE "purchase_return_resolution" AS ENUM (
  'REFUND',
  'SUPPLIER_CREDIT',
  'REPLACEMENT',
  'PAYABLE_REDUCTION',
  'UNKNOWN'
);

-- Short-close projection on PO items (not received quantity).
ALTER TABLE "purchase_order_items"
  ADD COLUMN "closed_unfulfilled_quantity" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_id_company_id_key" UNIQUE ("id", "company_id");

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_closed_qty_check"
  CHECK (
    "closed_unfulfilled_quantity" >= 0
    AND "closed_unfulfilled_quantity" <= "quantity"
  );

CREATE TABLE "purchase_order_corrections" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "purchase_order_item_id" UUID,
  "type" "purchase_correction_type" NOT NULL,
  "status" "purchase_correction_status" NOT NULL DEFAULT 'APPLIED',
  "reason" TEXT NOT NULL,
  "before_snapshot" JSONB NOT NULL,
  "after_snapshot" JSONB NOT NULL,
  "purchase_order_version" INTEGER NOT NULL,
  "applied_by_id" UUID NOT NULL,
  "applied_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "purchase_order_corrections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_order_corrections_id_company_id_key"
  ON "purchase_order_corrections"("id", "company_id");
CREATE INDEX "purchase_order_corrections_company_id_purchase_order_id_applied_at_idx"
  ON "purchase_order_corrections"("company_id", "purchase_order_id", "applied_at");
CREATE INDEX "purchase_order_corrections_company_id_purchase_order_item_id_idx"
  ON "purchase_order_corrections"("company_id", "purchase_order_item_id");

ALTER TABLE "purchase_order_corrections"
  ADD CONSTRAINT "purchase_order_corrections_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_corrections"
  ADD CONSTRAINT "purchase_order_corrections_purchase_order_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id") REFERENCES "purchase_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_corrections"
  ADD CONSTRAINT "purchase_order_corrections_purchase_order_item_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_item_id", "company_id") REFERENCES "purchase_order_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_corrections"
  ADD CONSTRAINT "purchase_order_corrections_applied_by_id_fkey"
  FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_discrepancies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "purchase_order_item_id" UUID NOT NULL,
  "type" "purchase_discrepancy_type" NOT NULL,
  "source" "purchase_discrepancy_source" NOT NULL,
  "status" "purchase_discrepancy_status" NOT NULL DEFAULT 'OPEN',
  "quantity" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "resolved_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" TIMESTAMPTZ(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "purchase_discrepancies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_discrepancies_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "purchase_discrepancies_id_company_id_key"
  ON "purchase_discrepancies"("id", "company_id");
CREATE INDEX "purchase_discrepancies_company_id_purchase_order_id_status_idx"
  ON "purchase_discrepancies"("company_id", "purchase_order_id", "status");
CREATE INDEX "purchase_discrepancies_company_id_purchase_order_item_id_status_idx"
  ON "purchase_discrepancies"("company_id", "purchase_order_item_id", "status");

ALTER TABLE "purchase_discrepancies"
  ADD CONSTRAINT "purchase_discrepancies_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_discrepancies"
  ADD CONSTRAINT "purchase_discrepancies_purchase_order_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id") REFERENCES "purchase_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_discrepancies"
  ADD CONSTRAINT "purchase_discrepancies_purchase_order_item_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_item_id", "company_id") REFERENCES "purchase_order_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_discrepancies"
  ADD CONSTRAINT "purchase_discrepancies_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_discrepancies"
  ADD CONSTRAINT "purchase_discrepancies_resolved_by_id_fkey"
  FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_return_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "purchase_return_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "purchase_return_sequences"
  ADD CONSTRAINT "purchase_return_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_returns" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "supplier_id" UUID NOT NULL,
  "purchase_order_id" UUID,
  "status" "purchase_return_status" NOT NULL DEFAULT 'DRAFT',
  "reason" "purchase_return_reason" NOT NULL,
  "expected_resolution" "purchase_return_resolution" NOT NULL DEFAULT 'UNKNOWN',
  "notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "approved_by_id" UUID,
  "cancelled_by_id" UUID,
  "cancellation_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "approved_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 1,

  CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_returns_id_company_id_key" ON "purchase_returns"("id", "company_id");
CREATE UNIQUE INDEX "purchase_returns_company_id_number_key" ON "purchase_returns"("company_id", "number");
CREATE INDEX "purchase_returns_company_id_status_idx" ON "purchase_returns"("company_id", "status");
CREATE INDEX "purchase_returns_company_id_supplier_id_created_at_idx"
  ON "purchase_returns"("company_id", "supplier_id", "created_at");
CREATE INDEX "purchase_returns_company_id_purchase_order_id_idx"
  ON "purchase_returns"("company_id", "purchase_order_id");

ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_supplier_id_company_id_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_purchase_order_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id") REFERENCES "purchase_orders"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns"
  ADD CONSTRAINT "purchase_returns_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_return_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "purchase_return_id" UUID NOT NULL,
  "purchase_order_item_id" UUID,
  "sku_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "reason" "purchase_return_reason",
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "purchase_return_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_return_items_quantity_check" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "purchase_return_items_id_company_id_key"
  ON "purchase_return_items"("id", "company_id");
CREATE INDEX "purchase_return_items_company_id_purchase_return_id_idx"
  ON "purchase_return_items"("company_id", "purchase_return_id");
CREATE INDEX "purchase_return_items_company_id_purchase_order_item_id_idx"
  ON "purchase_return_items"("company_id", "purchase_order_item_id");
CREATE INDEX "purchase_return_items_company_id_sku_id_idx"
  ON "purchase_return_items"("company_id", "sku_id");

ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_purchase_return_id_company_id_fkey"
  FOREIGN KEY ("purchase_return_id", "company_id") REFERENCES "purchase_returns"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_purchase_order_item_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_item_id", "company_id") REFERENCES "purchase_order_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_items"
  ADD CONSTRAINT "purchase_return_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
