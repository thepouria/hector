-- Phase 4.8 — Financial Ledger + Journal Foundation
-- Operational ≠ AccountMovement ≠ Journal. Journals balance in Company.baseCurrency.
-- Manual journal never creates AccountMovement.

CREATE TYPE "ledger_account_type" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "ledger_account_kind" AS ENUM ('SYSTEM', 'USER_DEFINED');
CREATE TYPE "ledger_account_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "journal_entry_status" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED');
CREATE TYPE "journal_line_direction" AS ENUM ('DEBIT', 'CREDIT');

-- ---------------------------------------------------------------------------
-- Ledger accounts (Chart of Accounts)
-- ---------------------------------------------------------------------------

CREATE TABLE "ledger_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ledger_account_type" NOT NULL,
    "system_key" TEXT,
    "kind" "ledger_account_kind" NOT NULL DEFAULT 'USER_DEFINED',
    "status" "ledger_account_status" NOT NULL DEFAULT 'ACTIVE',
    "parent_id" UUID,
    "description" TEXT,
    "created_by_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "archived_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_accounts_id_company_id_key"
  ON "ledger_accounts"("id", "company_id");
CREATE UNIQUE INDEX "ledger_accounts_company_id_code_key"
  ON "ledger_accounts"("company_id", "code");
CREATE UNIQUE INDEX "ledger_accounts_company_id_system_key_key"
  ON "ledger_accounts"("company_id", "system_key")
  WHERE "system_key" IS NOT NULL;

CREATE INDEX "ledger_accounts_company_system_key_idx"
  ON "ledger_accounts"("company_id", "system_key");
CREATE INDEX "ledger_accounts_company_type_status_idx"
  ON "ledger_accounts"("company_id", "type", "status");
CREATE INDEX "ledger_accounts_company_parent_id_idx"
  ON "ledger_accounts"("company_id", "parent_id");
CREATE INDEX "ledger_accounts_company_status_idx"
  ON "ledger_accounts"("company_id", "status");

ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_parent_company_fkey"
  FOREIGN KEY ("parent_id", "company_id")
  REFERENCES "ledger_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_accounts"
  ADD CONSTRAINT "ledger_accounts_archived_by_id_fkey"
  FOREIGN KEY ("archived_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Map FinancialAccount + ExpenseCategory → LedgerAccount
-- ---------------------------------------------------------------------------

ALTER TABLE "financial_accounts"
  ADD COLUMN "ledger_account_id" UUID;

CREATE INDEX "financial_accounts_company_ledger_account_id_idx"
  ON "financial_accounts"("company_id", "ledger_account_id");

ALTER TABLE "financial_accounts"
  ADD CONSTRAINT "financial_accounts_ledger_account_company_fkey"
  FOREIGN KEY ("ledger_account_id", "company_id")
  REFERENCES "ledger_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "expense_categories"
  ADD COLUMN "ledger_account_id" UUID;

CREATE INDEX "expense_categories_company_ledger_account_id_idx"
  ON "expense_categories"("company_id", "ledger_account_id");

ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_ledger_account_company_fkey"
  FOREIGN KEY ("ledger_account_id", "company_id")
  REFERENCES "ledger_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Journal sequences + entries + lines
-- ---------------------------------------------------------------------------

CREATE TABLE "journal_entry_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "journal_entry_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "journal_entry_sequences"
  ADD CONSTRAINT "journal_entry_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "journal_entry_status" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "source_type" TEXT NOT NULL,
    "source_id" UUID,
    "effect_type" TEXT NOT NULL,
    "base_currency" "currency_code" NOT NULL,
    "total_debit_base" DECIMAL(24, 6) NOT NULL,
    "total_credit_base" DECIMAL(24, 6) NOT NULL,
    "reversal_of_id" UUID,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_entries_totals_non_negative"
      CHECK ("total_debit_base" >= 0 AND "total_credit_base" >= 0)
);

CREATE UNIQUE INDEX "journal_entries_id_company_id_key"
  ON "journal_entries"("id", "company_id");
CREATE UNIQUE INDEX "journal_entries_company_id_number_key"
  ON "journal_entries"("company_id", "number");
CREATE UNIQUE INDEX "journal_entries_company_source_effect_key"
  ON "journal_entries"("company_id", "source_type", "source_id", "effect_type")
  WHERE "source_id" IS NOT NULL AND "status" IN ('DRAFT', 'POSTED', 'REVERSED');
CREATE UNIQUE INDEX "journal_entries_company_request_id_key"
  ON "journal_entries"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "journal_entries_company_source_idx"
  ON "journal_entries"("company_id", "source_type", "source_id", "effect_type");
CREATE INDEX "journal_entries_company_status_effective_idx"
  ON "journal_entries"("company_id", "status", "effective_at");
CREATE INDEX "journal_entries_company_reversal_of_idx"
  ON "journal_entries"("company_id", "reversal_of_id");
CREATE INDEX "journal_entries_company_request_id_idx"
  ON "journal_entries"("company_id", "request_id");

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_reversal_company_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "journal_entries"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "ledger_account_id" UUID NOT NULL,
    "direction" "journal_line_direction" NOT NULL,
    "original_amount" DECIMAL(24, 6) NOT NULL,
    "original_currency" "currency_code" NOT NULL,
    "base_amount" DECIMAL(24, 6) NOT NULL,
    "base_currency" "currency_code" NOT NULL,
    "fx_rate" DECIMAL(24, 8),
    "fx_rate_source" TEXT,
    "description" TEXT,
    "line_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_lines_original_amount_positive" CHECK ("original_amount" > 0),
    CONSTRAINT "journal_lines_base_amount_positive" CHECK ("base_amount" > 0)
);

CREATE UNIQUE INDEX "journal_lines_id_company_id_key"
  ON "journal_lines"("id", "company_id");
CREATE INDEX "journal_lines_company_journal_entry_idx"
  ON "journal_lines"("company_id", "journal_entry_id");
CREATE INDEX "journal_lines_company_ledger_account_idx"
  ON "journal_lines"("company_id", "ledger_account_id");
CREATE INDEX "journal_lines_company_ledger_created_idx"
  ON "journal_lines"("company_id", "ledger_account_id", "created_at");

ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_journal_company_fkey"
  FOREIGN KEY ("journal_entry_id", "company_id")
  REFERENCES "journal_entries"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_lines"
  ADD CONSTRAINT "journal_lines_ledger_company_fkey"
  FOREIGN KEY ("ledger_account_id", "company_id")
  REFERENCES "ledger_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
