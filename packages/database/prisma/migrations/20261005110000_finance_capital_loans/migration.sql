-- Phase 4.3 — Capital + Funding + Loans
-- Equity ≠ Debt ≠ Revenue. Outstanding is always derived (never an editable column).

CREATE TYPE "capital_contribution_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "capital_funding_type" AS ENUM ('OWNER_EQUITY', 'PARTNER_EQUITY', 'OTHER_FUNDING');
CREATE TYPE "loan_status" AS ENUM ('DRAFT', 'ACTIVE', 'PARTIALLY_REPAID', 'SETTLED', 'CANCELLED', 'REVERSED');
CREATE TYPE "loan_disbursement_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "loan_repayment_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');
CREATE TYPE "finance_counterparty_type" AS ENUM ('MEMBER', 'PARTNER', 'EXTERNAL_PERSON', 'SUPPLIER', 'OTHER');

-- ---------------------------------------------------------------------------
-- Capital contributions
-- ---------------------------------------------------------------------------

CREATE TABLE "capital_contribution_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "capital_contribution_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "capital_contribution_sequences"
  ADD CONSTRAINT "capital_contribution_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "capital_contributions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "funding_type" "capital_funding_type" NOT NULL,
    "contributor_type" "finance_counterparty_type" NOT NULL,
    "contributor_id" UUID,
    "contributor_name" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "capital_contribution_status" NOT NULL DEFAULT 'DRAFT',
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "reference" TEXT,
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

    CONSTRAINT "capital_contributions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "capital_contributions_amount_positive_check" CHECK ("amount" > 0)
);

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_account_company_fkey"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "capital_contributions_id_company_id_key"
  ON "capital_contributions"("id", "company_id");

CREATE UNIQUE INDEX "capital_contributions_company_id_number_key"
  ON "capital_contributions"("company_id", "number");

CREATE UNIQUE INDEX "capital_contributions_company_request_id_key"
  ON "capital_contributions"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_reversal_of_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "capital_contributions"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "capital_contributions_company_status_created_idx"
  ON "capital_contributions"("company_id", "status", "created_at");
CREATE INDEX "capital_contributions_company_account_idx"
  ON "capital_contributions"("company_id", "account_id");
CREATE INDEX "capital_contributions_company_funding_type_idx"
  ON "capital_contributions"("company_id", "funding_type");
CREATE INDEX "capital_contributions_company_currency_created_idx"
  ON "capital_contributions"("company_id", "currency", "created_at");
CREATE INDEX "capital_contributions_company_request_id_idx"
  ON "capital_contributions"("company_id", "request_id");

-- ---------------------------------------------------------------------------
-- Loans
-- ---------------------------------------------------------------------------

CREATE TABLE "loan_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "loan_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "loan_sequences"
  ADD CONSTRAINT "loan_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loans" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "lender_type" "finance_counterparty_type" NOT NULL,
    "lender_id" UUID,
    "lender_name" TEXT NOT NULL,
    "currency" "currency_code" NOT NULL,
    "contracted_principal" DECIMAL(24, 6) NOT NULL,
    "reference_fx_rate" DECIMAL(24, 8),
    "reference_fx_base_currency" "currency_code",
    "reference_fx_quote_currency" "currency_code",
    "due_date" TIMESTAMPTZ(3),
    "interest_rate" DECIMAL(24, 8),
    "interest_notes" TEXT,
    "fee_amount" DECIMAL(24, 6),
    "notes" TEXT,
    "reference" TEXT,
    "status" "loan_status" NOT NULL DEFAULT 'DRAFT',
    "receiving_account_id" UUID,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "posted_at" TIMESTAMPTZ(3),
    "posted_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loans_contracted_principal_positive_check" CHECK ("contracted_principal" > 0)
);

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_receiving_account_fkey"
  FOREIGN KEY ("receiving_account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "loans_id_company_id_key"
  ON "loans"("id", "company_id");

CREATE UNIQUE INDEX "loans_company_id_number_key"
  ON "loans"("company_id", "number");

CREATE UNIQUE INDEX "loans_company_request_id_key"
  ON "loans"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "loans_company_status_created_idx"
  ON "loans"("company_id", "status", "created_at");
CREATE INDEX "loans_company_currency_created_idx"
  ON "loans"("company_id", "currency", "created_at");
CREATE INDEX "loans_company_due_date_idx"
  ON "loans"("company_id", "due_date");
CREATE INDEX "loans_company_request_id_idx"
  ON "loans"("company_id", "request_id");

-- ---------------------------------------------------------------------------
-- Loan disbursements
-- ---------------------------------------------------------------------------

CREATE TABLE "loan_disbursement_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "loan_disbursement_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "loan_disbursement_sequences"
  ADD CONSTRAINT "loan_disbursement_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loan_disbursements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "loan_disbursement_status" NOT NULL DEFAULT 'DRAFT',
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
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loan_disbursements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loan_disbursements_amount_positive_check" CHECK ("amount" > 0)
);

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_loan_company_fkey"
  FOREIGN KEY ("loan_id", "company_id") REFERENCES "loans"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_account_company_fkey"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "loan_disbursements_id_company_id_key"
  ON "loan_disbursements"("id", "company_id");

CREATE UNIQUE INDEX "loan_disbursements_company_id_number_key"
  ON "loan_disbursements"("company_id", "number");

CREATE UNIQUE INDEX "loan_disbursements_company_request_id_key"
  ON "loan_disbursements"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

ALTER TABLE "loan_disbursements"
  ADD CONSTRAINT "loan_disbursements_reversal_of_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "loan_disbursements"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "loan_disbursements_company_loan_status_idx"
  ON "loan_disbursements"("company_id", "loan_id", "status");
CREATE INDEX "loan_disbursements_company_account_idx"
  ON "loan_disbursements"("company_id", "account_id");
CREATE INDEX "loan_disbursements_company_request_id_idx"
  ON "loan_disbursements"("company_id", "request_id");

-- ---------------------------------------------------------------------------
-- Loan repayments
-- ---------------------------------------------------------------------------

CREATE TABLE "loan_repayment_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "loan_repayment_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "loan_repayment_sequences"
  ADD CONSTRAINT "loan_repayment_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "loan_repayments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "loan_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "account_id" UUID NOT NULL,
    "principal_amount" DECIMAL(24, 6) NOT NULL,
    "interest_amount" DECIMAL(24, 6) NOT NULL DEFAULT 0,
    "fee_amount" DECIMAL(24, 6) NOT NULL DEFAULT 0,
    "currency" "currency_code" NOT NULL,
    "status" "loan_repayment_status" NOT NULL DEFAULT 'DRAFT',
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
    "reversal_of_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "loan_repayments_principal_positive_check" CHECK ("principal_amount" > 0),
    CONSTRAINT "loan_repayments_interest_nonneg_check" CHECK ("interest_amount" >= 0),
    CONSTRAINT "loan_repayments_fee_nonneg_check" CHECK ("fee_amount" >= 0)
);

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_loan_company_fkey"
  FOREIGN KEY ("loan_id", "company_id") REFERENCES "loans"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_account_company_fkey"
  FOREIGN KEY ("account_id", "company_id") REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "loan_repayments_id_company_id_key"
  ON "loan_repayments"("id", "company_id");

CREATE UNIQUE INDEX "loan_repayments_company_id_number_key"
  ON "loan_repayments"("company_id", "number");

CREATE UNIQUE INDEX "loan_repayments_company_request_id_key"
  ON "loan_repayments"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

ALTER TABLE "loan_repayments"
  ADD CONSTRAINT "loan_repayments_reversal_of_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "loan_repayments"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "loan_repayments_company_loan_status_idx"
  ON "loan_repayments"("company_id", "loan_id", "status");
CREATE INDEX "loan_repayments_company_account_idx"
  ON "loan_repayments"("company_id", "account_id");
CREATE INDEX "loan_repayments_company_request_id_idx"
  ON "loan_repayments"("company_id", "request_id");
