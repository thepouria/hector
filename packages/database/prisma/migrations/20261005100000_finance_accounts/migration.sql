-- Phase 4.2 — Financial Accounts + Cash / Bank / Wallet

CREATE TYPE "financial_account_type" AS ENUM ('CASH', 'BANK', 'WALLET', 'OTHER');
CREATE TYPE "financial_account_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "financial_account_movement_direction" AS ENUM ('IN', 'OUT');
CREATE TYPE "financial_account_movement_type" AS ENUM (
  'OPENING_BALANCE', 'MONEY_IN', 'MONEY_OUT', 'TRANSFER_IN', 'TRANSFER_OUT', 'REVERSAL'
);
CREATE TYPE "financial_account_transfer_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

CREATE TABLE "financial_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "financial_account_type" NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "financial_account_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "bank_name" TEXT,
    "account_number" TEXT,
    "iban" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_accounts_default_must_be_active_check"
      CHECK ("is_default" = false OR "status" = 'ACTIVE')
);

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "financial_accounts_id_company_id_key"
  ON "financial_accounts"("id", "company_id");

CREATE UNIQUE INDEX "financial_accounts_company_id_code_key"
  ON "financial_accounts"("company_id", "code");

-- At most one default account per company + currency (concurrency-safe).
CREATE UNIQUE INDEX "financial_accounts_one_default_per_company_currency"
  ON "financial_accounts"("company_id", "currency")
  WHERE "is_default" = true;

CREATE INDEX "financial_accounts_company_id_status_idx"
  ON "financial_accounts"("company_id", "status");
CREATE INDEX "financial_accounts_company_id_currency_idx"
  ON "financial_accounts"("company_id", "currency");
CREATE INDEX "financial_accounts_company_id_type_idx"
  ON "financial_accounts"("company_id", "type");
CREATE INDEX "financial_accounts_company_id_is_default_idx"
  ON "financial_accounts"("company_id", "is_default");
CREATE INDEX "financial_accounts_company_id_name_idx"
  ON "financial_accounts"("company_id", "name");

CREATE TABLE "financial_account_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "direction" "financial_account_movement_direction" NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "type" "financial_account_movement_type" NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "posted_at" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT,
    "request_id" UUID,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_account_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_account_movements_amount_positive_check"
      CHECK ("amount" > 0)
);

ALTER TABLE "financial_account_movements"
  ADD CONSTRAINT "financial_account_movements_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_movements"
  ADD CONSTRAINT "financial_account_movements_account_company_fkey"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_movements"
  ADD CONSTRAINT "financial_account_movements_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "financial_account_movements_id_company_id_key"
  ON "financial_account_movements"("id", "company_id");

-- One opening balance movement per account.
CREATE UNIQUE INDEX "financial_account_movements_one_opening_per_account"
  ON "financial_account_movements"("account_id")
  WHERE "type" = 'OPENING_BALANCE';

-- Company-scoped idempotency for money commands that set request_id.
CREATE UNIQUE INDEX "financial_account_movements_company_request_id_key"
  ON "financial_account_movements"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "financial_account_movements_company_account_posted_idx"
  ON "financial_account_movements"("company_id", "account_id", "posted_at");
CREATE INDEX "financial_account_movements_company_source_idx"
  ON "financial_account_movements"("company_id", "source_type", "source_id");
CREATE INDEX "financial_account_movements_company_type_posted_idx"
  ON "financial_account_movements"("company_id", "type", "posted_at");
CREATE INDEX "financial_account_movements_company_request_id_idx"
  ON "financial_account_movements"("company_id", "request_id");

CREATE TABLE "financial_account_transfer_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "financial_account_transfer_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "financial_account_transfer_sequences"
  ADD CONSTRAINT "financial_account_transfer_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "financial_account_transfers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "source_account_id" UUID NOT NULL,
    "destination_account_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "financial_account_transfer_status" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "reversal_of_transfer_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "financial_account_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "financial_account_transfers_amount_positive_check"
      CHECK ("amount" > 0),
    CONSTRAINT "financial_account_transfers_distinct_accounts_check"
      CHECK ("source_account_id" <> "destination_account_id")
);

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_source_account_fkey"
  FOREIGN KEY ("source_account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_destination_account_fkey"
  FOREIGN KEY ("destination_account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "financial_account_transfers_id_company_id_key"
  ON "financial_account_transfers"("id", "company_id");

CREATE UNIQUE INDEX "financial_account_transfers_company_id_number_key"
  ON "financial_account_transfers"("company_id", "number");

CREATE UNIQUE INDEX "financial_account_transfers_company_request_id_key"
  ON "financial_account_transfers"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

ALTER TABLE "financial_account_transfers"
  ADD CONSTRAINT "financial_account_transfers_reversal_of_fkey"
  FOREIGN KEY ("reversal_of_transfer_id", "company_id")
  REFERENCES "financial_account_transfers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "financial_account_transfers_company_status_created_idx"
  ON "financial_account_transfers"("company_id", "status", "created_at");
CREATE INDEX "financial_account_transfers_company_source_idx"
  ON "financial_account_transfers"("company_id", "source_account_id");
CREATE INDEX "financial_account_transfers_company_destination_idx"
  ON "financial_account_transfers"("company_id", "destination_account_id");
CREATE INDEX "financial_account_transfers_company_currency_created_idx"
  ON "financial_account_transfers"("company_id", "currency", "created_at");
CREATE INDEX "financial_account_transfers_company_request_id_idx"
  ON "financial_account_transfers"("company_id", "request_id");
