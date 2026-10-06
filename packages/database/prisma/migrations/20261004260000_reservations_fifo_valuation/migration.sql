-- Phase 3.15: Inventory Reservations + FIFO Cost Layers + Valuation Foundation

CREATE TYPE "inventory_reservation_status" AS ENUM (
  'ACTIVE',
  'RELEASED',
  'CONSUMED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "inventory_reservation_source_type" AS ENUM (
  'SALES_ORDER',
  'MARKETPLACE_ORDER',
  'MANUAL_OPERATION',
  'OTHER'
);

CREATE TYPE "inventory_cost_layer_source_type" AS ENUM (
  'GOODS_RECEIPT',
  'TRANSFER_IN',
  'RECLASSIFY_IN',
  'ADJUSTMENT_IN',
  'STOCK_COUNT_ADJUSTMENT_IN',
  'OPENING_BALANCE',
  'SYSTEM_BOOTSTRAP',
  'SEED'
);

CREATE TYPE "inventory_valuation_status" AS ENUM (
  'VALUED',
  'PARTIALLY_VALUED',
  'UNVALUED'
);

CREATE TYPE "inventory_layer_consumption_kind" AS ENUM (
  'ISSUE',
  'ADJUSTMENT_OUT',
  'STOCK_COUNT_ADJUSTMENT_OUT',
  'RETURN_OUT',
  'TRANSFER_OUT',
  'RECLASSIFY_OUT'
);

CREATE TABLE "inventory_availability_locks" (
  "company_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_availability_locks_pkey"
    PRIMARY KEY ("company_id", "warehouse_id", "sku_id"),
  CONSTRAINT "inventory_availability_locks_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_availability_locks_warehouse_company_fkey"
    FOREIGN KEY ("warehouse_id", "company_id")
      REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_availability_locks_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id")
      REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "inventory_reservations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "source_type" "inventory_reservation_source_type" NOT NULL,
  "source_id" UUID NOT NULL,
  "source_line_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "quantity" INTEGER NOT NULL,
  "remaining_quantity" INTEGER NOT NULL,
  "status" "inventory_reservation_status" NOT NULL DEFAULT 'ACTIVE',
  "expires_at" TIMESTAMPTZ(3),
  "released_at" TIMESTAMPTZ(3),
  "consumed_at" TIMESTAMPTZ(3),
  "expired_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "inventory_reservations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_reservations_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_reservations_remaining_nonneg" CHECK ("remaining_quantity" >= 0),
  CONSTRAINT "inventory_reservations_remaining_lte_qty" CHECK ("remaining_quantity" <= "quantity"),
  CONSTRAINT "inventory_reservations_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "inventory_reservations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_warehouse_company_fkey"
    FOREIGN KEY ("warehouse_id", "company_id")
      REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id")
      REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_reservations_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_reservations_id_company_id_key"
  ON "inventory_reservations"("id", "company_id");
CREATE UNIQUE INDEX "inventory_reservations_company_id_request_id_key"
  ON "inventory_reservations"("company_id", "request_id");
CREATE UNIQUE INDEX "inventory_reservations_company_source_identity_key"
  ON "inventory_reservations"("company_id", "source_type", "source_id", "source_line_id");
CREATE INDEX "inventory_reservations_company_wh_sku_status_idx"
  ON "inventory_reservations"("company_id", "warehouse_id", "sku_id", "status");
CREATE INDEX "inventory_reservations_company_source_idx"
  ON "inventory_reservations"("company_id", "source_type", "source_id");
CREATE INDEX "inventory_reservations_company_status_expires_idx"
  ON "inventory_reservations"("company_id", "status", "expires_at");
CREATE INDEX "inventory_reservations_company_created_at_idx"
  ON "inventory_reservations"("company_id", "created_at");

CREATE TABLE "inventory_cost_layers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "batch_id" UUID,
  "classification" "stock_classification" NOT NULL DEFAULT 'SELLABLE',
  "source_type" "inventory_cost_layer_source_type" NOT NULL,
  "source_id" UUID NOT NULL,
  "source_line_id" UUID NOT NULL,
  "purchase_order_id" UUID,
  "purchase_order_item_id" UUID,
  "goods_receipt_id" UUID,
  "goods_receipt_item_id" UUID,
  "parent_layer_id" UUID,
  "received_at" TIMESTAMPTZ(3) NOT NULL,
  "original_quantity" INTEGER NOT NULL,
  "remaining_quantity" INTEGER NOT NULL,
  "valuation_status" "inventory_valuation_status" NOT NULL,
  "original_currency" "currency_code",
  "original_unit_amount" DECIMAL(24, 6),
  "reference_fx_rate" DECIMAL(24, 8),
  "base_currency_unit_cost" DECIMAL(24, 6),
  "has_unallocated_purchase_costs" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "inventory_cost_layers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_cost_layers_original_positive" CHECK ("original_quantity" > 0),
  CONSTRAINT "inventory_cost_layers_remaining_nonneg" CHECK ("remaining_quantity" >= 0),
  CONSTRAINT "inventory_cost_layers_remaining_lte_original"
    CHECK ("remaining_quantity" <= "original_quantity"),
  CONSTRAINT "inventory_cost_layers_valued_has_base_cost" CHECK (
    ("valuation_status" = 'UNVALUED' AND "base_currency_unit_cost" IS NULL)
    OR ("valuation_status" <> 'UNVALUED' AND "base_currency_unit_cost" IS NOT NULL)
  ),
  CONSTRAINT "inventory_cost_layers_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_cost_layers_warehouse_company_fkey"
    FOREIGN KEY ("warehouse_id", "company_id")
      REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_cost_layers_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id")
      REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_cost_layers_batch_company_fkey"
    FOREIGN KEY ("batch_id", "company_id")
      REFERENCES "batches"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_cost_layers_id_company_id_key"
  ON "inventory_cost_layers"("id", "company_id");
CREATE UNIQUE INDEX "inventory_cost_layers_company_source_line_key"
  ON "inventory_cost_layers"("company_id", "source_type", "source_line_id");
CREATE INDEX "inventory_cost_layers_fifo_lookup_idx"
  ON "inventory_cost_layers"("company_id", "warehouse_id", "sku_id", "remaining_quantity");
CREATE INDEX "inventory_cost_layers_fifo_order_idx"
  ON "inventory_cost_layers"("company_id", "warehouse_id", "sku_id", "classification", "received_at");
CREATE INDEX "inventory_cost_layers_poi_idx"
  ON "inventory_cost_layers"("company_id", "purchase_order_item_id");
CREATE INDEX "inventory_cost_layers_gri_idx"
  ON "inventory_cost_layers"("company_id", "goods_receipt_item_id");
CREATE INDEX "inventory_cost_layers_parent_idx"
  ON "inventory_cost_layers"("company_id", "parent_layer_id");
CREATE INDEX "inventory_cost_layers_valuation_idx"
  ON "inventory_cost_layers"("company_id", "valuation_status");

ALTER TABLE "inventory_cost_layers"
  ADD CONSTRAINT "inventory_cost_layers_parent_company_fkey"
  FOREIGN KEY ("parent_layer_id", "company_id")
    REFERENCES "inventory_cost_layers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory_layer_consumptions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "inventory_movement_id" UUID NOT NULL,
  "cost_layer_id" UUID NOT NULL,
  "kind" "inventory_layer_consumption_kind" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unit_cost" DECIMAL(24, 6),
  "total_cost" DECIMAL(24, 6),
  "valuation_status" "inventory_valuation_status" NOT NULL,
  "destination_layer_id" UUID,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "inventory_layer_consumptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_layer_consumptions_quantity_positive" CHECK ("quantity" > 0),
  CONSTRAINT "inventory_layer_consumptions_cost_null_pair" CHECK (
    ("unit_cost" IS NULL AND "total_cost" IS NULL)
    OR ("unit_cost" IS NOT NULL AND "total_cost" IS NOT NULL)
  ),
  CONSTRAINT "inventory_layer_consumptions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_layer_consumptions_movement_company_fkey"
    FOREIGN KEY ("inventory_movement_id", "company_id")
      REFERENCES "inventory_movements"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_layer_consumptions_layer_company_fkey"
    FOREIGN KEY ("cost_layer_id", "company_id")
      REFERENCES "inventory_cost_layers"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_layer_consumptions_id_company_id_key"
  ON "inventory_layer_consumptions"("id", "company_id");
CREATE UNIQUE INDEX "inventory_layer_consumptions_movement_layer_key"
  ON "inventory_layer_consumptions"("company_id", "inventory_movement_id", "cost_layer_id");
CREATE INDEX "inventory_layer_consumptions_movement_idx"
  ON "inventory_layer_consumptions"("inventory_movement_id");
CREATE INDEX "inventory_layer_consumptions_layer_idx"
  ON "inventory_layer_consumptions"("cost_layer_id");
CREATE INDEX "inventory_layer_consumptions_company_created_idx"
  ON "inventory_layer_consumptions"("company_id", "created_at");
