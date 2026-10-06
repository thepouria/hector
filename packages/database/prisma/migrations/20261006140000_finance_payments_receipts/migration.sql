-- Phase 4.6 — Payments + Receipts (standalone money in/out).
-- Transfers remain FinancialAccountTransfer (no second Transfer model).
-- Payment purpose SUPPLIER does NOT settle SupplierPayable (Phase 4.9).

CREATE TYPE "payment_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "receipt_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "payment_purpose_type" AS ENUM (
  'SUPPLIER',
  'LOAN',
  'EXPENSE',
  'REFUND',
  'CAPITAL_WITHDRAWAL',
  'OTHER'
);
CREATE TYPE "receipt_source_type" AS ENUM (
  'CAPITAL',
  'LOAN',
  'CUSTOMER',
  'REFUND',
  'OTHER'
);

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------

CREATE TABLE "payment_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "payment_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "payment_sequences"
  ADD CONSTRAINT "payment_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "receipt_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "receipt_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "receipt_sequences"
  ADD CONSTRAINT "receipt_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Payment
-- ---------------------------------------------------------------------------

CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "counterparty_type" "finance_counterparty_type",
    "counterparty_id" UUID,
    "counterparty_name" TEXT,
    "purpose_type" "payment_purpose_type" NOT NULL,
    "purpose_reference_type" TEXT,
    "purpose_reference_id" UUID,
    "reference" TEXT,
    "external_reference" TEXT,
    "notes" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "payments_id_company_id_key" ON "payments"("id", "company_id");
CREATE UNIQUE INDEX "payments_company_id_number_key" ON "payments"("company_id", "number");
CREATE UNIQUE INDEX "payments_company_request_id_key"
  ON "payments"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "payments_company_status_created_idx"
  ON "payments"("company_id", "status", "created_at");
CREATE INDEX "payments_company_account_idx"
  ON "payments"("company_id", "account_id");
CREATE INDEX "payments_company_purpose_idx"
  ON "payments"("company_id", "purpose_type");
CREATE INDEX "payments_company_currency_created_idx"
  ON "payments"("company_id", "currency", "created_at");
CREATE INDEX "payments_company_reversal_of_idx"
  ON "payments"("company_id", "reversal_of_id");
CREATE INDEX "payments_company_request_id_idx"
  ON "payments"("company_id", "request_id");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_account_company_fkey"
  FOREIGN KEY ("account_id", "company_id")
  REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_reversal_of_company_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "payments"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Receipt
-- ---------------------------------------------------------------------------

CREATE TABLE "receipts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "receipt_status" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "counterparty_type" "finance_counterparty_type",
    "counterparty_id" UUID,
    "counterparty_name" TEXT,
    "source_type" "receipt_source_type" NOT NULL,
    "source_reference_type" TEXT,
    "source_reference_id" UUID,
    "reference" TEXT,
    "external_reference" TEXT,
    "notes" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "receipts_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "receipts_id_company_id_key" ON "receipts"("id", "company_id");
CREATE UNIQUE INDEX "receipts_company_id_number_key" ON "receipts"("company_id", "number");
CREATE UNIQUE INDEX "receipts_company_request_id_key"
  ON "receipts"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "receipts_company_status_created_idx"
  ON "receipts"("company_id", "status", "created_at");
CREATE INDEX "receipts_company_account_idx"
  ON "receipts"("company_id", "account_id");
CREATE INDEX "receipts_company_source_idx"
  ON "receipts"("company_id", "source_type");
CREATE INDEX "receipts_company_currency_created_idx"
  ON "receipts"("company_id", "currency", "created_at");
CREATE INDEX "receipts_company_reversal_of_idx"
  ON "receipts"("company_id", "reversal_of_id");
CREATE INDEX "receipts_company_request_id_idx"
  ON "receipts"("company_id", "request_id");

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_account_company_fkey"
  FOREIGN KEY ("account_id", "company_id")
  REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "receipts"
  ADD CONSTRAINT "receipts_reversal_of_company_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "receipts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
