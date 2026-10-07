-- Phase 6.4 — Reconciliation Engine

CREATE TYPE "reconciliation_source_type" AS ENUM ('CHANNEL', 'SUPPLIER_PAYABLE', 'LOAN', 'SETTLEMENT');
CREATE TYPE "reconciliation_status" AS ENUM (
  'OPEN',
  'PARTIALLY_MATCHED',
  'MATCHED',
  'DISCREPANCY',
  'UNDER_REVIEW',
  'RESOLVED',
  'CANCELLED'
);
CREATE TYPE "reconciliation_discrepancy_reason" AS ENUM (
  'BANK_FEE',
  'COMMISSION_DIFFERENCE',
  'RETURN_DIFFERENCE',
  'FEE_DIFFERENCE',
  'ROUNDING',
  'TIMING_DIFFERENCE',
  'DUPLICATE_TRANSACTION',
  'MISSING_TRANSACTION',
  'WRONG_AMOUNT',
  'WRONG_REFERENCE',
  'FX_DIFFERENCE',
  'MANUAL_ADJUSTMENT',
  'OTHER'
);
CREATE TYPE "reconciliation_discrepancy_status" AS ENUM ('OPEN', 'UNDER_REVIEW', 'RESOLVED');
CREATE TYPE "reconciliation_resolution_type" AS ENUM (
  'EXPLAINED',
  'ADJUSTMENT_CREATED',
  'ALLOCATION_CORRECTED',
  'SOURCE_CORRECTED',
  'FINANCE_TRANSACTION_CORRECTED',
  'ACCEPTED_VARIANCE',
  'OTHER'
);

CREATE TABLE "reconciliation_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "reconciliation_sequences_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "reconciliation_sequences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "reconciliations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "source_type" "reconciliation_source_type" NOT NULL,
  "source_id" UUID NOT NULL,
  "currency" "currency_code" NOT NULL,
  "status" "reconciliation_status" NOT NULL DEFAULT 'OPEN',
  "expected_snapshot" DECIMAL(24, 6),
  "matching_closed_at" TIMESTAMPTZ(3),
  "matching_closed_by_id" UUID,
  "review_started_at" TIMESTAMPTZ(3),
  "review_started_by_id" UUID,
  "resolved_at" TIMESTAMPTZ(3),
  "resolved_by_id" UUID,
  "resolution_type" "reconciliation_resolution_type",
  "resolution_notes" TEXT,
  "notes" TEXT,
  "request_id" UUID,
  "cancelled_at" TIMESTAMPTZ(3),
  "cancelled_by_id" UUID,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliations_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "reconciliations_company_id_number_key" UNIQUE ("company_id", "number"),
  CONSTRAINT "reconciliations_company_id_request_id_key" UNIQUE ("company_id", "request_id"),
  CONSTRAINT "reconciliations_company_source_key" UNIQUE ("company_id", "source_type", "source_id"),
  CONSTRAINT "reconciliations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliations_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliations_matching_closed_by_fkey"
    FOREIGN KEY ("matching_closed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliations_review_started_by_fkey"
    FOREIGN KEY ("review_started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliations_resolved_by_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliations_cancelled_by_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "reconciliations_company_id_status_created_at_idx"
  ON "reconciliations"("company_id", "status", "created_at");
CREATE INDEX "reconciliations_company_id_source_type_source_id_idx"
  ON "reconciliations"("company_id", "source_type", "source_id");
CREATE INDEX "reconciliations_company_id_currency_status_idx"
  ON "reconciliations"("company_id", "currency", "status");

CREATE TABLE "reconciliation_discrepancies" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "reconciliation_id" UUID NOT NULL,
  "amount" DECIMAL(24, 6) NOT NULL,
  "currency" "currency_code" NOT NULL,
  "reason_code" "reconciliation_discrepancy_reason" NOT NULL,
  "description" TEXT,
  "status" "reconciliation_discrepancy_status" NOT NULL DEFAULT 'OPEN',
  "resolved_at" TIMESTAMPTZ(3),
  "resolved_by_id" UUID,
  "resolution_type" "reconciliation_resolution_type",
  "resolution_reference" TEXT,
  "resolution_notes" TEXT,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "reconciliation_discrepancies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reconciliation_discrepancies_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "reconciliation_discrepancies_reconciliation_fkey"
    FOREIGN KEY ("reconciliation_id", "company_id") REFERENCES "reconciliations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliation_discrepancies_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliation_discrepancies_created_by_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "reconciliation_discrepancies_resolved_by_fkey"
    FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "reconciliation_discrepancies_company_reconciliation_status_idx"
  ON "reconciliation_discrepancies"("company_id", "reconciliation_id", "status");
CREATE INDEX "reconciliation_discrepancies_company_reason_idx"
  ON "reconciliation_discrepancies"("company_id", "reason_code");
