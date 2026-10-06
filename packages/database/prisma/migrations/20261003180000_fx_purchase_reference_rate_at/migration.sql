-- Phase 2.6 FX Purchase — optional reference rate timestamp + list filter index.
-- referenceLocalValuation remains derived (not persisted). Settlement stays Finance.

ALTER TABLE "purchase_orders"
  ADD COLUMN "reference_fx_rate_at" TIMESTAMPTZ(3);

CREATE INDEX "purchase_orders_company_id_purchase_type_due_date_idx"
  ON "purchase_orders"("company_id", "purchase_type", "due_date");
