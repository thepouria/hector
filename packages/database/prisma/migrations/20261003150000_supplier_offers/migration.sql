-- Phase 2.3 Supplier Offers / Price Quotes

CREATE TYPE "purchase_commercial_type" AS ENUM ('CASH', 'TERM_CREDIT', 'FX_CREDIT');
CREATE TYPE "payment_term_type" AS ENUM ('IMMEDIATE', 'NET_DAYS', 'FIXED_DATE');

CREATE TABLE "supplier_offers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "supplier_contact_id" UUID,
    "unit_price" DECIMAL(24,6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "purchase_type" "purchase_commercial_type",
    "payment_term_type" "payment_term_type",
    "net_days" INTEGER,
    "quoted_quantity" INTEGER,
    "minimum_quantity" INTEGER,
    "available_quantity" INTEGER,
    "reference_fx_rate" DECIMAL(24,8),
    "reference_fx_base_currency" "currency_code",
    "reference_fx_quote_currency" "currency_code",
    "quoted_at" TIMESTAMPTZ(3) NOT NULL,
    "valid_until" TIMESTAMPTZ(3),
    "notes" TEXT,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "supplier_offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "supplier_offers_unit_price_positive" CHECK ("unit_price" > 0),
    CONSTRAINT "supplier_offers_net_days_positive" CHECK ("net_days" IS NULL OR "net_days" > 0),
    CONSTRAINT "supplier_offers_quoted_qty_positive" CHECK ("quoted_quantity" IS NULL OR "quoted_quantity" > 0),
    CONSTRAINT "supplier_offers_min_qty_positive" CHECK ("minimum_quantity" IS NULL OR "minimum_quantity" > 0),
    CONSTRAINT "supplier_offers_available_qty_nonneg" CHECK ("available_quantity" IS NULL OR "available_quantity" >= 0),
    CONSTRAINT "supplier_offers_valid_until_ge_quoted" CHECK ("valid_until" IS NULL OR "valid_until" >= "quoted_at"),
    CONSTRAINT "supplier_offers_fx_pair_complete" CHECK (
      ("reference_fx_rate" IS NULL AND "reference_fx_base_currency" IS NULL AND "reference_fx_quote_currency" IS NULL)
      OR
      ("reference_fx_rate" IS NOT NULL AND "reference_fx_base_currency" IS NOT NULL AND "reference_fx_quote_currency" IS NOT NULL AND "reference_fx_rate" > 0)
    )
);

CREATE INDEX "supplier_offers_company_id_quoted_at_idx" ON "supplier_offers"("company_id", "quoted_at");
CREATE INDEX "supplier_offers_company_id_supplier_id_quoted_at_idx" ON "supplier_offers"("company_id", "supplier_id", "quoted_at");
CREATE INDEX "supplier_offers_company_id_sku_id_quoted_at_idx" ON "supplier_offers"("company_id", "sku_id", "quoted_at");
CREATE INDEX "supplier_offers_company_id_currency_quoted_at_idx" ON "supplier_offers"("company_id", "currency", "quoted_at");
CREATE INDEX "supplier_offers_supplier_id_sku_id_quoted_at_idx" ON "supplier_offers"("supplier_id", "sku_id", "quoted_at");
CREATE INDEX "supplier_offers_company_id_valid_until_idx" ON "supplier_offers"("company_id", "valid_until");

ALTER TABLE "supplier_offers"
  ADD CONSTRAINT "supplier_offers_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_offers"
  ADD CONSTRAINT "supplier_offers_supplier_id_company_id_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_offers"
  ADD CONSTRAINT "supplier_offers_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_offers"
  ADD CONSTRAINT "supplier_offers_supplier_contact_id_company_id_fkey"
  FOREIGN KEY ("supplier_contact_id", "company_id") REFERENCES "supplier_contacts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_offers"
  ADD CONSTRAINT "supplier_offers_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
