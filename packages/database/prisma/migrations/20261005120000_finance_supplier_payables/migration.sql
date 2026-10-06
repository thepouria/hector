-- Phase 4.4 — Supplier Payables
-- Liability ledger is truth. Outstanding is always derived. Cash does NOT move on recognition.

CREATE TYPE "supplier_payable_status" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "supplier_payable_purchase_type" AS ENUM ('CASH', 'TERM_CREDIT', 'FX_CREDIT', 'OPENING');
CREATE TYPE "supplier_liability_movement_direction" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "supplier_liability_movement_type" AS ENUM (
  'PURCHASE_RECOGNITION',
  'PURCHASE_CORRECTION',
  'SUPPLIER_RETURN',
  'PAYMENT_ALLOCATION',
  'OPENING_BALANCE',
  'REVERSAL',
  'SUPPLIER_CREDIT'
);
CREATE TYPE "supplier_credit_status" AS ENUM ('OPEN', 'APPLIED', 'CANCELLED');
CREATE TYPE "supplier_payment_allocation_status" AS ENUM ('POSTED');

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_payable_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "supplier_payable_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "supplier_payable_sequences"
  ADD CONSTRAINT "supplier_payable_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "supplier_credit_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "supplier_credit_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "supplier_credit_sequences"
  ADD CONSTRAINT "supplier_credit_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- SupplierPayable
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_payables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "purchase_order_id" UUID,
    "purchase_type" "supplier_payable_purchase_type" NOT NULL,
    "currency" "currency_code" NOT NULL,
    "reference_fx_rate" DECIMAL(24, 8),
    "reference_fx_base_currency" "currency_code",
    "reference_fx_quote_currency" "currency_code",
    "due_date" TIMESTAMPTZ(3),
    "status" "supplier_payable_status" NOT NULL DEFAULT 'OPEN',
    "recognized_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "reference" TEXT,
    "request_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_payables_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "supplier_payables"
  ADD CONSTRAINT "supplier_payables_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payables"
  ADD CONSTRAINT "supplier_payables_supplier_company_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payables"
  ADD CONSTRAINT "supplier_payables_po_company_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id") REFERENCES "purchase_orders"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "supplier_payables_id_company_id_key"
  ON "supplier_payables"("id", "company_id");

CREATE UNIQUE INDEX "supplier_payables_company_id_number_key"
  ON "supplier_payables"("company_id", "number");

CREATE UNIQUE INDEX "supplier_payables_company_request_id_key"
  ON "supplier_payables"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

-- One payable document per PO + currency (opening has null PO).
CREATE UNIQUE INDEX "supplier_payables_company_po_currency_key"
  ON "supplier_payables"("company_id", "purchase_order_id", "currency")
  WHERE "purchase_order_id" IS NOT NULL;

CREATE INDEX "supplier_payables_company_status_created_idx"
  ON "supplier_payables"("company_id", "status", "created_at");
CREATE INDEX "supplier_payables_company_supplier_currency_idx"
  ON "supplier_payables"("company_id", "supplier_id", "currency");
CREATE INDEX "supplier_payables_company_due_date_idx"
  ON "supplier_payables"("company_id", "due_date");
CREATE INDEX "supplier_payables_company_request_id_idx"
  ON "supplier_payables"("company_id", "request_id");

-- ---------------------------------------------------------------------------
-- SupplierPayableLine
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_payable_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "goods_receipt_item_id" UUID NOT NULL,
    "purchase_order_item_id" UUID NOT NULL,
    "sku_id" UUID,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(24, 6) NOT NULL,
    "line_amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "recognized_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payable_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_payable_lines_quantity_positive_check" CHECK ("quantity" > 0),
    CONSTRAINT "supplier_payable_lines_unit_price_nonneg_check" CHECK ("unit_price" >= 0),
    CONSTRAINT "supplier_payable_lines_line_amount_nonneg_check" CHECK ("line_amount" >= 0)
);

ALTER TABLE "supplier_payable_lines"
  ADD CONSTRAINT "supplier_payable_lines_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payable_lines"
  ADD CONSTRAINT "supplier_payable_lines_payable_company_fkey"
  FOREIGN KEY ("payable_id", "company_id") REFERENCES "supplier_payables"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payable_lines"
  ADD CONSTRAINT "supplier_payable_lines_grn_company_fkey"
  FOREIGN KEY ("goods_receipt_id", "company_id") REFERENCES "goods_receipts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payable_lines"
  ADD CONSTRAINT "supplier_payable_lines_grn_item_company_fkey"
  FOREIGN KEY ("goods_receipt_item_id", "company_id") REFERENCES "goods_receipt_items"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payable_lines"
  ADD CONSTRAINT "supplier_payable_lines_po_item_company_fkey"
  FOREIGN KEY ("purchase_order_item_id", "company_id") REFERENCES "purchase_order_items"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "supplier_payable_lines_id_company_id_key"
  ON "supplier_payable_lines"("id", "company_id");

-- Idempotent recognition: one line per goods receipt item.
CREATE UNIQUE INDEX "supplier_payable_lines_company_grn_item_key"
  ON "supplier_payable_lines"("company_id", "goods_receipt_item_id");

CREATE INDEX "supplier_payable_lines_company_payable_idx"
  ON "supplier_payable_lines"("company_id", "payable_id");
CREATE INDEX "supplier_payable_lines_company_grn_idx"
  ON "supplier_payable_lines"("company_id", "goods_receipt_id");

-- ---------------------------------------------------------------------------
-- SupplierLiabilityMovement (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_liability_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "payable_id" UUID,
    "supplier_id" UUID NOT NULL,
    "direction" "supplier_liability_movement_direction" NOT NULL,
    "type" "supplier_liability_movement_type" NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "supplier_credit_id" UUID,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_liability_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_liability_movements_amount_positive_check" CHECK ("amount" > 0)
);

ALTER TABLE "supplier_liability_movements"
  ADD CONSTRAINT "supplier_liability_movements_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_liability_movements"
  ADD CONSTRAINT "supplier_liability_movements_payable_company_fkey"
  FOREIGN KEY ("payable_id", "company_id") REFERENCES "supplier_payables"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_liability_movements"
  ADD CONSTRAINT "supplier_liability_movements_supplier_company_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_liability_movements"
  ADD CONSTRAINT "supplier_liability_movements_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "supplier_liability_movements_id_company_id_key"
  ON "supplier_liability_movements"("id", "company_id");

CREATE UNIQUE INDEX "supplier_liability_movements_idempotency_key"
  ON "supplier_liability_movements"("company_id", "source_type", "source_id", "type");

CREATE UNIQUE INDEX "supplier_liability_movements_company_request_id_key"
  ON "supplier_liability_movements"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "supplier_liability_movements_company_payable_created_idx"
  ON "supplier_liability_movements"("company_id", "payable_id", "created_at");
CREATE INDEX "supplier_liability_movements_company_supplier_currency_idx"
  ON "supplier_liability_movements"("company_id", "supplier_id", "currency");
CREATE INDEX "supplier_liability_movements_company_source_idx"
  ON "supplier_liability_movements"("company_id", "source_type", "source_id");

-- ---------------------------------------------------------------------------
-- SupplierCredit
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_credits" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "currency" "currency_code" NOT NULL,
    "original_amount" DECIMAL(24, 6) NOT NULL,
    "status" "supplier_credit_status" NOT NULL DEFAULT 'OPEN',
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "payable_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_credits_original_amount_positive_check" CHECK ("original_amount" > 0)
);

ALTER TABLE "supplier_credits"
  ADD CONSTRAINT "supplier_credits_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_credits"
  ADD CONSTRAINT "supplier_credits_supplier_company_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_credits"
  ADD CONSTRAINT "supplier_credits_payable_company_fkey"
  FOREIGN KEY ("payable_id", "company_id") REFERENCES "supplier_payables"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "supplier_credits_id_company_id_key"
  ON "supplier_credits"("id", "company_id");

CREATE UNIQUE INDEX "supplier_credits_company_id_number_key"
  ON "supplier_credits"("company_id", "number");

CREATE UNIQUE INDEX "supplier_credits_company_source_key"
  ON "supplier_credits"("company_id", "source_type", "source_id");

CREATE INDEX "supplier_credits_company_supplier_status_idx"
  ON "supplier_credits"("company_id", "supplier_id", "status");

-- Back-fill FK from movements → credits (created after both tables exist)
ALTER TABLE "supplier_liability_movements"
  ADD CONSTRAINT "supplier_liability_movements_credit_company_fkey"
  FOREIGN KEY ("supplier_credit_id", "company_id") REFERENCES "supplier_credits"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- SupplierPaymentAllocation (foundation for Phase 4.6 — no cash)
-- ---------------------------------------------------------------------------

CREATE TABLE "supplier_payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "payable_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "payment_source_type" TEXT,
    "payment_source_id" UUID,
    "request_id" UUID,
    "status" "supplier_payment_allocation_status" NOT NULL DEFAULT 'POSTED',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_payment_allocations_amount_positive_check" CHECK ("amount" > 0)
);

ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_payable_company_fkey"
  FOREIGN KEY ("payable_id", "company_id") REFERENCES "supplier_payables"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "supplier_payment_allocations_id_company_id_key"
  ON "supplier_payment_allocations"("id", "company_id");

CREATE UNIQUE INDEX "supplier_payment_allocations_company_request_id_key"
  ON "supplier_payment_allocations"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "supplier_payment_allocations_company_payable_idx"
  ON "supplier_payment_allocations"("company_id", "payable_id");
