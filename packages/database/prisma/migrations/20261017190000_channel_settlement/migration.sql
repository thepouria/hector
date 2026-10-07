-- Phase 6.3 — Channel Settlement (manual-first) + Receipt allocation FK

CREATE TYPE "channel_settlement_status" AS ENUM ('DRAFT', 'OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE "channel_settlement_component_type" AS ENUM ('GROSS_SALES', 'COMMISSION', 'RETURN', 'FEE', 'ADJUSTMENT');
CREATE TYPE "channel_settlement_component_effect" AS ENUM ('INCREASE', 'DECREASE');

ALTER TABLE "settlement_allocations"
  ADD COLUMN "receipt_id" UUID;

ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_receipt_fkey"
  FOREIGN KEY ("receipt_id", "company_id")
  REFERENCES "receipts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "settlement_allocations_company_id_receipt_id_status_idx"
  ON "settlement_allocations"("company_id", "receipt_id", "status");

-- Enforce: PAYMENT ↔ paymentId, RECEIPT ↔ receiptId
ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_finance_fk_consistency"
  CHECK (
    (finance_txn_type = 'PAYMENT' AND payment_id IS NOT NULL AND payment_id = finance_txn_id AND receipt_id IS NULL)
    OR
    (finance_txn_type = 'RECEIPT' AND receipt_id IS NOT NULL AND receipt_id = finance_txn_id AND payment_id IS NULL)
  );

CREATE TABLE "channel_settlement_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "channel_settlement_sequences_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "channel_settlement_sequences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "channel_settlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "channel_id" UUID NOT NULL,
  "period_start" TIMESTAMPTZ(3) NOT NULL,
  "period_end" TIMESTAMPTZ(3) NOT NULL,
  "currency" "currency_code" NOT NULL,
  "expected_net" DECIMAL(24, 6) NOT NULL DEFAULT 0,
  "status" "channel_settlement_status" NOT NULL DEFAULT 'DRAFT',
  "external_reference" TEXT,
  "notes" TEXT,
  "request_id" UUID,
  "finalized_at" TIMESTAMPTZ(3),
  "finalized_by_id" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancelled_by_id" UUID,
  "created_by_id" UUID NOT NULL,
  "updated_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "channel_settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "channel_settlements_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "channel_settlements_company_id_number_key" UNIQUE ("company_id", "number"),
  CONSTRAINT "channel_settlements_company_id_request_id_key" UNIQUE ("company_id", "request_id"),
  CONSTRAINT "channel_settlements_company_channel_ext_key" UNIQUE ("company_id", "channel_id", "external_reference"),
  CONSTRAINT "channel_settlements_period_valid" CHECK ("period_start" <= "period_end"),
  CONSTRAINT "channel_settlements_expected_net_non_negative" CHECK ("expected_net" >= 0),
  CONSTRAINT "channel_settlements_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlements_channel_fkey"
    FOREIGN KEY ("channel_id", "company_id") REFERENCES "sales_channels"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlements_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlements_updated_by_fkey"
    FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlements_finalized_by_fkey"
    FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlements_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "channel_settlements_company_id_status_created_at_idx"
  ON "channel_settlements"("company_id", "status", "created_at");
CREATE INDEX "channel_settlements_company_id_channel_id_period_start_idx"
  ON "channel_settlements"("company_id", "channel_id", "period_start");
CREATE INDEX "channel_settlements_company_id_currency_status_idx"
  ON "channel_settlements"("company_id", "currency", "status");
CREATE INDEX "channel_settlements_company_id_period_start_period_end_idx"
  ON "channel_settlements"("company_id", "period_start", "period_end");

CREATE TABLE "channel_settlement_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "channel_settlement_id" UUID NOT NULL,
  "type" "channel_settlement_component_type" NOT NULL,
  "effect" "channel_settlement_component_effect" NOT NULL,
  "amount" DECIMAL(24, 6) NOT NULL,
  "currency" "currency_code" NOT NULL,
  "description" TEXT,
  "reference" TEXT,
  "notes" TEXT,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "channel_settlement_components_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "channel_settlement_components_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "channel_settlement_components_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "channel_settlement_components_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlement_components_settlement_fkey"
    FOREIGN KEY ("channel_settlement_id", "company_id")
    REFERENCES "channel_settlements"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "channel_settlement_components_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "channel_settlement_components_company_settlement_type_idx"
  ON "channel_settlement_components"("company_id", "channel_settlement_id", "type");
CREATE INDEX "channel_settlement_components_company_settlement_sort_idx"
  ON "channel_settlement_components"("company_id", "channel_settlement_id", "sort_order");
