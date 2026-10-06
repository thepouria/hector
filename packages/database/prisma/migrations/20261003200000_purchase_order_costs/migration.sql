-- Phase 2.8 Purchase Costs
-- Normalized PO-level commercial acquisition costs. Not payment / payable / FIFO allocation.

CREATE TYPE "purchase_cost_type" AS ENUM (
  'COURIER',
  'FREIGHT',
  'PURCHASE_FEE',
  'TRANSFER_FEE',
  'PACKAGING',
  'CUSTOMS',
  'OTHER'
);

CREATE TYPE "purchase_cost_status" AS ENUM ('ACTIVE', 'VOIDED');

CREATE TYPE "purchase_cost_allocation_method" AS ENUM (
  'UNALLOCATED',
  'BY_QUANTITY',
  'BY_VALUE',
  'MANUAL'
);

CREATE TABLE "purchase_order_costs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "purchase_order_id" UUID NOT NULL,
  "type" "purchase_cost_type" NOT NULL,
  "status" "purchase_cost_status" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT,
  "amount" DECIMAL(24,6) NOT NULL,
  "currency" "currency_code" NOT NULL,
  "cost_date" TIMESTAMPTZ(3) NOT NULL,
  "payee_name" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "allocation_method" "purchase_cost_allocation_method" NOT NULL DEFAULT 'UNALLOCATED',
  "supplier_id" UUID,
  "created_by_id" UUID NOT NULL,
  "voided_by_id" UUID,
  "void_reason" TEXT,
  "voided_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "purchase_order_costs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "purchase_order_costs_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "purchase_order_costs_id_company_id_key"
  ON "purchase_order_costs"("id", "company_id");

CREATE INDEX "purchase_order_costs_company_id_purchase_order_id_status_idx"
  ON "purchase_order_costs"("company_id", "purchase_order_id", "status");

CREATE INDEX "purchase_order_costs_company_id_cost_date_idx"
  ON "purchase_order_costs"("company_id", "cost_date");

CREATE INDEX "purchase_order_costs_company_id_type_status_idx"
  ON "purchase_order_costs"("company_id", "type", "status");

ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_purchase_order_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id")
  REFERENCES "purchase_orders"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_supplier_id_company_id_fkey"
  FOREIGN KEY ("supplier_id", "company_id")
  REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_voided_by_id_fkey"
  FOREIGN KEY ("voided_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
