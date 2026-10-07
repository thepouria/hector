-- Phase 6.1 — Settlement Allocation Core
-- Generic matching foundation. Phase 4.9 SupplierPaymentAllocation remains live AP path.

CREATE TYPE "settlement_status" AS ENUM (
  'DRAFT',
  'OPEN',
  'PARTIALLY_SETTLED',
  'SETTLED',
  'CANCELLED'
);

CREATE TYPE "settlement_type" AS ENUM (
  'GENERIC',
  'SUPPLIER_PAYABLE',
  'LOAN',
  'FX_LIABILITY',
  'CHANNEL',
  'OTHER'
);

CREATE TYPE "settlement_source_type" AS ENUM (
  'MANUAL_OBLIGATION',
  'SUPPLIER_PAYABLE',
  'LOAN',
  'FX_LIABILITY',
  'CHANNEL'
);

CREATE TYPE "settlement_finance_txn_type" AS ENUM (
  'PAYMENT',
  'RECEIPT'
);

CREATE TYPE "settlement_allocation_status" AS ENUM (
  'ACTIVE',
  'REVERSED'
);

CREATE TYPE "settlement_manual_obligation_status" AS ENUM (
  'ACTIVE',
  'CLOSED'
);

CREATE TABLE "settlement_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "settlement_sequences_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "settlement_sequences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "settlement_manual_obligations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "party_id" UUID,
  "currency" "currency_code" NOT NULL,
  "original_amount" DECIMAL(24, 6) NOT NULL,
  "status" "settlement_manual_obligation_status" NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_manual_obligations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_manual_obligations_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "settlement_manual_obligations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_manual_obligations_party_fkey"
    FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_manual_obligations_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "settlement_manual_obligations_company_id_status_idx"
  ON "settlement_manual_obligations"("company_id", "status");
CREATE INDEX "settlement_manual_obligations_company_id_party_id_idx"
  ON "settlement_manual_obligations"("company_id", "party_id");

CREATE TABLE "settlements" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "type" "settlement_type" NOT NULL DEFAULT 'GENERIC',
  "status" "settlement_status" NOT NULL DEFAULT 'DRAFT',
  "party_id" UUID,
  "currency" "currency_code" NOT NULL,
  "settlement_date" TIMESTAMPTZ(3),
  "reference" TEXT,
  "notes" TEXT,
  "request_id" UUID,
  "created_by_id" UUID NOT NULL,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancelled_by_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlements_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "settlements_company_id_number_key" UNIQUE ("company_id", "number"),
  CONSTRAINT "settlements_company_id_request_id_key" UNIQUE ("company_id", "request_id"),
  CONSTRAINT "settlements_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlements_party_fkey"
    FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlements_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlements_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "settlements_company_id_status_created_at_idx"
  ON "settlements"("company_id", "status", "created_at");
CREATE INDEX "settlements_company_id_party_id_idx"
  ON "settlements"("company_id", "party_id");
CREATE INDEX "settlements_company_id_type_status_idx"
  ON "settlements"("company_id", "type", "status");

CREATE TABLE "settlement_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "settlement_id" UUID NOT NULL,
  "source_type" "settlement_source_type" NOT NULL,
  "source_id" UUID NOT NULL,
  "currency" "currency_code" NOT NULL,
  "original_amount" DECIMAL(24, 6) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_items_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "settlement_items_company_settlement_source_key"
    UNIQUE ("company_id", "settlement_id", "source_type", "source_id"),
  CONSTRAINT "settlement_items_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_items_settlement_fkey"
    FOREIGN KEY ("settlement_id", "company_id") REFERENCES "settlements"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "settlement_items_company_id_settlement_id_idx"
  ON "settlement_items"("company_id", "settlement_id");
CREATE INDEX "settlement_items_company_id_source_type_source_id_idx"
  ON "settlement_items"("company_id", "source_type", "source_id");

CREATE TABLE "settlement_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "settlement_id" UUID NOT NULL,
  "settlement_item_id" UUID NOT NULL,
  "finance_txn_type" "settlement_finance_txn_type" NOT NULL,
  "finance_txn_id" UUID NOT NULL,
  "payment_id" UUID,
  "amount" DECIMAL(24, 6) NOT NULL,
  "currency" "currency_code" NOT NULL,
  "status" "settlement_allocation_status" NOT NULL DEFAULT 'ACTIVE',
  "request_id" UUID,
  "allocated_at" TIMESTAMPTZ(3) NOT NULL,
  "created_by_id" UUID NOT NULL,
  "reversed_at" TIMESTAMPTZ(3),
  "reversed_by_id" UUID,
  "reverse_reason" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_allocations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_allocations_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "settlement_allocations_company_id_request_id_key" UNIQUE ("company_id", "request_id"),
  CONSTRAINT "settlement_allocations_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "settlement_allocations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocations_settlement_fkey"
    FOREIGN KEY ("settlement_id", "company_id") REFERENCES "settlements"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocations_item_fkey"
    FOREIGN KEY ("settlement_item_id", "company_id") REFERENCES "settlement_items"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocations_payment_fkey"
    FOREIGN KEY ("payment_id", "company_id") REFERENCES "payments"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocations_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocations_reversed_by_id_fkey"
    FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "settlement_allocations_company_id_settlement_id_status_idx"
  ON "settlement_allocations"("company_id", "settlement_id", "status");
CREATE INDEX "settlement_allocations_company_id_settlement_item_id_status_idx"
  ON "settlement_allocations"("company_id", "settlement_item_id", "status");
CREATE INDEX "settlement_allocations_company_id_finance_txn_type_finance_txn_id_status_idx"
  ON "settlement_allocations"("company_id", "finance_txn_type", "finance_txn_id", "status");
CREATE INDEX "settlement_allocations_company_id_payment_id_status_idx"
  ON "settlement_allocations"("company_id", "payment_id", "status");
