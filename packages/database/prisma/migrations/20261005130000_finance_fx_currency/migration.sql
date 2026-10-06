-- Phase 4.5 — FX + Currency Ledger
-- Rates are immutable snapshots. Currency ledger is projected (no CurrencyLedgerEntry table).
-- FX conversion posts MONEY_OUT + MONEY_IN with sourceType FX_CONVERSION.
-- Valuation never mutates cash / payable / loan.

CREATE TYPE "fx_rate_type" AS ENUM ('REFERENCE', 'CONVERSION', 'SETTLEMENT', 'VALUATION');
CREATE TYPE "fx_rate_source_type" AS ENUM (
  'MANUAL',
  'PURCHASE',
  'FX_TRANSACTION',
  'SETTLEMENT',
  'SYSTEM',
  'EXTERNAL'
);
CREATE TYPE "fx_conversion_status" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- ---------------------------------------------------------------------------
-- Sequences
-- ---------------------------------------------------------------------------

CREATE TABLE "fx_conversion_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "fx_conversion_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "fx_conversion_sequences"
  ADD CONSTRAINT "fx_conversion_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- FxRate (immutable create-new; archive soft)
-- ---------------------------------------------------------------------------

CREATE TABLE "fx_rates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "base_currency" "currency_code" NOT NULL,
    "quote_currency" "currency_code" NOT NULL,
    "rate" DECIMAL(24, 8) NOT NULL,
    "rate_type" "fx_rate_type" NOT NULL,
    "source_type" "fx_rate_source_type" NOT NULL DEFAULT 'MANUAL',
    "source_reference" TEXT,
    "effective_at" TIMESTAMPTZ(3) NOT NULL,
    "notes" TEXT,
    "archived_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fx_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fx_rates_rate_positive" CHECK ("rate" > 0),
    CONSTRAINT "fx_rates_base_ne_quote" CHECK ("base_currency" <> "quote_currency")
);

CREATE UNIQUE INDEX "fx_rates_id_company_id_key" ON "fx_rates"("id", "company_id");

CREATE INDEX "fx_rates_lookup_idx"
  ON "fx_rates"("company_id", "base_currency", "quote_currency", "rate_type", "effective_at" DESC);

CREATE INDEX "fx_rates_company_effective_idx"
  ON "fx_rates"("company_id", "effective_at" DESC);

CREATE INDEX "fx_rates_company_archived_idx"
  ON "fx_rates"("company_id", "archived_at");

ALTER TABLE "fx_rates"
  ADD CONSTRAINT "fx_rates_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_rates"
  ADD CONSTRAINT "fx_rates_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- FxConversion
-- ---------------------------------------------------------------------------

CREATE TABLE "fx_conversions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "source_account_id" UUID NOT NULL,
    "destination_account_id" UUID NOT NULL,
    "from_amount" DECIMAL(24, 6) NOT NULL,
    "from_currency" "currency_code" NOT NULL,
    "to_amount" DECIMAL(24, 6) NOT NULL,
    "to_currency" "currency_code" NOT NULL,
    "applied_rate" DECIMAL(24, 8) NOT NULL,
    "rate_base_currency" "currency_code" NOT NULL,
    "rate_quote_currency" "currency_code" NOT NULL,
    "rate_type" "fx_rate_type" NOT NULL DEFAULT 'CONVERSION',
    "fx_rate_id" UUID,
    "fee_amount" DECIMAL(24, 6),
    "fee_currency" "currency_code",
    "fee_account_id" UUID,
    "status" "fx_conversion_status" NOT NULL DEFAULT 'DRAFT',
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

    CONSTRAINT "fx_conversions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "fx_conversions_from_positive" CHECK ("from_amount" > 0),
    CONSTRAINT "fx_conversions_to_positive" CHECK ("to_amount" > 0),
    CONSTRAINT "fx_conversions_applied_rate_positive" CHECK ("applied_rate" > 0),
    CONSTRAINT "fx_conversions_currencies_differ" CHECK ("from_currency" <> "to_currency"),
    CONSTRAINT "fx_conversions_rate_pair_differ" CHECK ("rate_base_currency" <> "rate_quote_currency"),
    CONSTRAINT "fx_conversions_rate_type_conversion" CHECK ("rate_type" = 'CONVERSION'),
    CONSTRAINT "fx_conversions_fee_consistency" CHECK (
      ("fee_amount" IS NULL AND "fee_currency" IS NULL AND "fee_account_id" IS NULL)
      OR (
        "fee_amount" IS NOT NULL AND "fee_amount" > 0
        AND "fee_currency" IS NOT NULL
        AND "fee_account_id" IS NOT NULL
      )
    )
);

-- Composite unique must exist before composite FKs (including self-reference).
CREATE UNIQUE INDEX "fx_conversions_id_company_id_key"
  ON "fx_conversions"("id", "company_id");

CREATE UNIQUE INDEX "fx_conversions_company_id_number_key"
  ON "fx_conversions"("company_id", "number");

CREATE UNIQUE INDEX "fx_conversions_company_request_id_key"
  ON "fx_conversions"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "fx_conversions_company_status_created_idx"
  ON "fx_conversions"("company_id", "status", "created_at");

CREATE INDEX "fx_conversions_company_source_idx"
  ON "fx_conversions"("company_id", "source_account_id");

CREATE INDEX "fx_conversions_company_destination_idx"
  ON "fx_conversions"("company_id", "destination_account_id");

CREATE INDEX "fx_conversions_company_currencies_idx"
  ON "fx_conversions"("company_id", "from_currency", "to_currency");

CREATE INDEX "fx_conversions_company_fx_rate_idx"
  ON "fx_conversions"("company_id", "fx_rate_id");

CREATE INDEX "fx_conversions_company_reversal_of_idx"
  ON "fx_conversions"("company_id", "reversal_of_id");

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_source_account_company_fkey"
  FOREIGN KEY ("source_account_id", "company_id")
  REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_destination_account_company_fkey"
  FOREIGN KEY ("destination_account_id", "company_id")
  REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_fee_account_company_fkey"
  FOREIGN KEY ("fee_account_id", "company_id")
  REFERENCES "financial_accounts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_fx_rate_company_fkey"
  FOREIGN KEY ("fx_rate_id", "company_id")
  REFERENCES "fx_rates"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "fx_conversions"
  ADD CONSTRAINT "fx_conversions_reversal_of_company_fkey"
  FOREIGN KEY ("reversal_of_id", "company_id")
  REFERENCES "fx_conversions"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
