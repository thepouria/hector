-- Phase 4.9 — Liability Settlement (Supplier AP ↔ Payment)
-- Evolve SupplierPaymentAllocation: hard paymentId FK, REVERSED status, FX settle columns.
-- ExpensePaymentAllocation remains SoT for expenses. No auto-settle on Payment post.

-- ---------------------------------------------------------------------------
-- Status: POSTED | REVERSED
-- ---------------------------------------------------------------------------

ALTER TYPE "supplier_payment_allocation_status" ADD VALUE 'REVERSED';

-- ---------------------------------------------------------------------------
-- Columns
-- ---------------------------------------------------------------------------

ALTER TABLE "supplier_payment_allocations"
  ADD COLUMN IF NOT EXISTS "payment_id" UUID,
  ADD COLUMN IF NOT EXISTS "payment_currency" "currency_code",
  ADD COLUMN IF NOT EXISTS "payment_amount_applied" DECIMAL(24, 6),
  ADD COLUMN IF NOT EXISTS "liability_amount_settled" DECIMAL(24, 6),
  ADD COLUMN IF NOT EXISTS "settlement_rate" DECIMAL(24, 8),
  ADD COLUMN IF NOT EXISTS "settlement_rate_base_currency" "currency_code",
  ADD COLUMN IF NOT EXISTS "settlement_rate_quote_currency" "currency_code",
  ADD COLUMN IF NOT EXISTS "settlement_fx_rate_id" UUID,
  ADD COLUMN IF NOT EXISTS "base_carrying_amount" DECIMAL(24, 6),
  ADD COLUMN IF NOT EXISTS "base_payment_amount" DECIMAL(24, 6),
  ADD COLUMN IF NOT EXISTS "fx_difference_base" DECIMAL(24, 6),
  ADD COLUMN IF NOT EXISTS "settlement_group_id" UUID,
  ADD COLUMN IF NOT EXISTS "reversed_at" TIMESTAMPTZ(3),
  ADD COLUMN IF NOT EXISTS "reversed_by_id" UUID;

-- Backfill settle amounts for legacy rows (liability-only foundation)
UPDATE "supplier_payment_allocations"
SET
  "liability_amount_settled" = "amount",
  "payment_amount_applied" = "amount",
  "payment_currency" = "currency",
  "base_carrying_amount" = "amount",
  "base_payment_amount" = "amount",
  "fx_difference_base" = 0
WHERE "liability_amount_settled" IS NULL;

ALTER TABLE "supplier_payment_allocations"
  ALTER COLUMN "liability_amount_settled" SET NOT NULL,
  ALTER COLUMN "payment_amount_applied" SET NOT NULL,
  ALTER COLUMN "payment_currency" SET NOT NULL;

-- Note: do not auto-backfill payment_id from soft payment_source* —
-- legacy liability-only rows have no settlement journal (FIN-SET-005).

-- ---------------------------------------------------------------------------
-- Checks
-- ---------------------------------------------------------------------------

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_payment_amount_positive_check";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_payment_amount_positive_check"
  CHECK ("payment_amount_applied" > 0);

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_liability_amount_positive_check";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_liability_amount_positive_check"
  CHECK ("liability_amount_settled" > 0);

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_fx_rate_pair_check";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_fx_rate_pair_check"
  CHECK (
    (
      "settlement_rate" IS NULL
      AND "settlement_rate_base_currency" IS NULL
      AND "settlement_rate_quote_currency" IS NULL
    )
    OR (
      "settlement_rate" IS NOT NULL
      AND "settlement_rate" > 0
      AND "settlement_rate_base_currency" IS NOT NULL
      AND "settlement_rate_quote_currency" IS NOT NULL
      AND "settlement_rate_base_currency" <> "settlement_rate_quote_currency"
    )
  );

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_reversed_consistency_check";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_reversed_consistency_check"
  CHECK (
    (
      "status" = 'POSTED'
      AND "reversed_at" IS NULL
      AND "reversed_by_id" IS NULL
    )
    OR (
      "status" = 'REVERSED'
      AND "reversed_at" IS NOT NULL
      AND "reversed_by_id" IS NOT NULL
    )
  );

-- ---------------------------------------------------------------------------
-- FKs + indexes
-- ---------------------------------------------------------------------------

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_payment_company_fkey";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_payment_company_fkey"
  FOREIGN KEY ("payment_id", "company_id")
  REFERENCES "payments"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_reversed_by_id_fkey";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payment_allocations"
  DROP CONSTRAINT IF EXISTS "supplier_payment_allocations_settlement_fx_rate_company_fkey";
ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_settlement_fx_rate_company_fkey"
  FOREIGN KEY ("settlement_fx_rate_id", "company_id")
  REFERENCES "fx_rates"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Replace single-row requestId uniqueness with (requestId, payableId) for multi-liability batches
DROP INDEX IF EXISTS "supplier_payment_allocations_company_request_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_payment_allocations_company_request_payable_key"
  ON "supplier_payment_allocations"("company_id", "request_id", "payable_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "supplier_payment_allocations_company_payment_status_idx"
  ON "supplier_payment_allocations"("company_id", "payment_id", "status");

CREATE INDEX IF NOT EXISTS "supplier_payment_allocations_company_settlement_group_idx"
  ON "supplier_payment_allocations"("company_id", "settlement_group_id")
  WHERE "settlement_group_id" IS NOT NULL;
