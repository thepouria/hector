-- Phase 6.2 — Payables + Loans + FX Settlement
-- Obligation amount vs payment amount dimensions + FX allocation evidence.

ALTER TABLE "settlement_allocations"
  ADD COLUMN "payment_amount" DECIMAL(24, 6),
  ADD COLUMN "payment_currency" "currency_code";

-- Backfill same-currency rows from Phase 6.1
UPDATE "settlement_allocations"
SET
  "payment_amount" = "amount",
  "payment_currency" = "currency"
WHERE "payment_amount" IS NULL;

ALTER TABLE "settlement_allocations"
  ALTER COLUMN "payment_amount" SET NOT NULL,
  ALTER COLUMN "payment_currency" SET NOT NULL;

ALTER TABLE "settlement_allocations"
  ADD CONSTRAINT "settlement_allocations_payment_amount_positive"
  CHECK ("payment_amount" > 0);

CREATE TABLE "settlement_allocation_fx_details" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "allocation_id" UUID NOT NULL,
  "payment_currency" "currency_code" NOT NULL,
  "payment_amount" DECIMAL(24, 6) NOT NULL,
  "obligation_currency" "currency_code" NOT NULL,
  "obligation_amount" DECIMAL(24, 6) NOT NULL,
  "rate" DECIMAL(24, 8) NOT NULL,
  "rate_base_currency" "currency_code" NOT NULL,
  "rate_quote_currency" "currency_code" NOT NULL,
  "rate_date" TIMESTAMPTZ(3) NOT NULL,
  "rate_source_type" "fx_rate_source_type" NOT NULL DEFAULT 'MANUAL',
  "fx_rate_id" UUID,
  "rounding_difference" DECIMAL(24, 6) NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "settlement_allocation_fx_details_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlement_allocation_fx_details_id_company_id_key" UNIQUE ("id", "company_id"),
  CONSTRAINT "settlement_allocation_fx_details_allocation_id_key" UNIQUE ("allocation_id"),
  CONSTRAINT "settlement_allocation_fx_details_payment_positive" CHECK ("payment_amount" > 0),
  CONSTRAINT "settlement_allocation_fx_details_obligation_positive" CHECK ("obligation_amount" > 0),
  CONSTRAINT "settlement_allocation_fx_details_rate_positive" CHECK ("rate" > 0),
  CONSTRAINT "settlement_allocation_fx_details_currencies_distinct"
    CHECK ("payment_currency" <> "obligation_currency"),
  CONSTRAINT "settlement_allocation_fx_details_rate_pair_distinct"
    CHECK ("rate_base_currency" <> "rate_quote_currency"),
  CONSTRAINT "settlement_allocation_fx_details_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocation_fx_details_allocation_fkey"
    FOREIGN KEY ("allocation_id", "company_id")
    REFERENCES "settlement_allocations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "settlement_allocation_fx_details_fx_rate_fkey"
    FOREIGN KEY ("fx_rate_id", "company_id")
    REFERENCES "fx_rates"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "settlement_allocation_fx_details"
  ADD CONSTRAINT "settlement_allocation_fx_details_allocation_company_key"
  UNIQUE ("allocation_id", "company_id");
