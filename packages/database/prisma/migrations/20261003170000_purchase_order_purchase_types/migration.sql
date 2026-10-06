-- Phase 2.5 Purchase Types — commercial terms on PurchaseOrder.
-- CASH / TERM_CREDIT / FX_CREDIT. No payments, ledger, or warehouse.

CREATE TYPE "purchase_term_basis" AS ENUM ('ORDER_DATE');

ALTER TABLE "purchase_orders"
  ADD COLUMN "term_basis" "purchase_term_basis",
  ADD COLUMN "due_date" TIMESTAMPTZ(3),
  ADD COLUMN "obligation_amount" DECIMAL(24,6),
  ADD COLUMN "obligation_currency" "currency_code",
  ADD COLUMN "reference_fx_rate" DECIMAL(24,8),
  ADD COLUMN "reference_fx_base_currency" "currency_code",
  ADD COLUMN "reference_fx_quote_currency" "currency_code";

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_obligation_amount_positive"
  CHECK ("obligation_amount" IS NULL OR "obligation_amount" > 0);

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_reference_fx_rate_positive"
  CHECK ("reference_fx_rate" IS NULL OR "reference_fx_rate" > 0);

CREATE INDEX "purchase_orders_company_id_due_date_idx"
  ON "purchase_orders"("company_id", "due_date");
