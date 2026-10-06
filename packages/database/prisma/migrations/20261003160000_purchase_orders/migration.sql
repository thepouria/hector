-- Phase 2.4 Purchase Order Core
-- Lifecycle: DRAFT -> APPROVED -> ORDERED; DRAFT/APPROVED/ORDERED -> CANCELLED.
-- Receiving / payments / costs are NOT part of this migration.

CREATE TYPE "purchase_order_status" AS ENUM ('DRAFT', 'APPROVED', 'ORDERED', 'CANCELLED');

-- Composite FK target so PO items can reference an offer inside the same company.
CREATE UNIQUE INDEX "supplier_offers_id_company_id_key" ON "supplier_offers"("id", "company_id");

CREATE TABLE "purchase_order_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_order_sequences_pkey" PRIMARY KEY ("company_id"),
    CONSTRAINT "purchase_order_sequences_next_value_positive" CHECK ("next_value" >= 1)
);

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "supplier_contact_id" UUID,
    "status" "purchase_order_status" NOT NULL DEFAULT 'DRAFT',
    "currency" "currency_code" NOT NULL,
    "purchase_type" "purchase_commercial_type",
    "payment_term_type" "payment_term_type",
    "net_days" INTEGER,
    "order_date" TIMESTAMPTZ(3) NOT NULL,
    "expected_at" TIMESTAMPTZ(3),
    "notes" TEXT,
    "cancellation_reason" TEXT,
    "subtotal" DECIMAL(24,6) NOT NULL,
    "total" DECIMAL(24,6) NOT NULL,
    "supplier_name_snapshot" TEXT,
    "supplier_code_snapshot" TEXT,
    "created_by_id" UUID NOT NULL,
    "approved_by_id" UUID,
    "ordered_by_id" UUID,
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "ordered_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_orders_subtotal_nonneg" CHECK ("subtotal" >= 0),
    CONSTRAINT "purchase_orders_total_nonneg" CHECK ("total" >= 0),
    CONSTRAINT "purchase_orders_net_days_positive" CHECK ("net_days" IS NULL OR "net_days" > 0),
    CONSTRAINT "purchase_orders_version_positive" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "purchase_orders_id_company_id_key" ON "purchase_orders"("id", "company_id");
CREATE UNIQUE INDEX "purchase_orders_company_id_number_key" ON "purchase_orders"("company_id", "number");
CREATE INDEX "purchase_orders_company_id_status_idx" ON "purchase_orders"("company_id", "status");
CREATE INDEX "purchase_orders_company_id_order_date_idx" ON "purchase_orders"("company_id", "order_date");
CREATE INDEX "purchase_orders_company_id_supplier_id_order_date_idx" ON "purchase_orders"("company_id", "supplier_id", "order_date");

CREATE TABLE "purchase_order_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" DECIMAL(24,6) NOT NULL,
    "line_subtotal" DECIMAL(24,6) NOT NULL,
    "supplier_offer_id" UUID,
    "notes" TEXT,
    "sku_code_snapshot" TEXT,
    "product_name_snapshot" TEXT,
    "variant_label_snapshot" TEXT,
    "product_id_snapshot" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_order_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_items_quantity_positive" CHECK ("quantity" > 0),
    CONSTRAINT "purchase_order_items_unit_price_positive" CHECK ("unit_price" > 0),
    CONSTRAINT "purchase_order_items_line_subtotal_positive" CHECK ("line_subtotal" > 0)
);

CREATE UNIQUE INDEX "purchase_order_items_purchase_order_id_sku_id_key" ON "purchase_order_items"("purchase_order_id", "sku_id");
CREATE INDEX "purchase_order_items_company_id_sku_id_idx" ON "purchase_order_items"("company_id", "sku_id");
CREATE INDEX "purchase_order_items_company_id_purchase_order_id_idx" ON "purchase_order_items"("company_id", "purchase_order_id");
CREATE INDEX "purchase_order_items_supplier_offer_id_idx" ON "purchase_order_items"("supplier_offer_id");

-- Sequence
ALTER TABLE "purchase_order_sequences"
  ADD CONSTRAINT "purchase_order_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purchase orders
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_supplier_id_company_id_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_supplier_contact_id_company_id_fkey"
  FOREIGN KEY ("supplier_contact_id", "company_id") REFERENCES "supplier_contacts"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_ordered_by_id_fkey"
  FOREIGN KEY ("ordered_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Purchase order items
ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_purchase_order_id_company_id_fkey"
  FOREIGN KEY ("purchase_order_id", "company_id") REFERENCES "purchase_orders"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "purchase_order_items"
  ADD CONSTRAINT "purchase_order_items_supplier_offer_id_company_id_fkey"
  FOREIGN KEY ("supplier_offer_id", "company_id") REFERENCES "supplier_offers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
