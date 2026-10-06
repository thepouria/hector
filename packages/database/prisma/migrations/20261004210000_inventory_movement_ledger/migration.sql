-- Phase 3.9: Inventory Movement Ledger + On Hand balance projection.

CREATE TYPE "inventory_movement_type" AS ENUM (
  'RECEIVE',
  'ISSUE',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'RETURN_IN',
  'RETURN_OUT',
  'STOCK_COUNT_ADJUSTMENT_IN',
  'STOCK_COUNT_ADJUSTMENT_OUT',
  'OPENING_BALANCE',
  'SYSTEM_CORRECTION'
);

CREATE TYPE "inventory_source_type" AS ENUM (
  'PUTAWAY',
  'MANUAL_ADJUSTMENT',
  'TRANSFER',
  'SALES_FULFILLMENT',
  'CUSTOMER_RETURN',
  'SUPPLIER_RETURN',
  'STOCK_COUNT',
  'OPENING_BALANCE',
  'SYSTEM_CORRECTION',
  'SEED'
);

CREATE TABLE "inventory_movements" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "movement_type" "inventory_movement_type" NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_type" "inventory_source_type" NOT NULL,
    "source_id" UUID NOT NULL,
    "source_line_id" UUID NOT NULL,
    "operation_id" UUID,
    "reason_code" TEXT,
    "notes" TEXT,
    "reversal_of_movement_id" UUID,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_movements_quantity_nonzero"
      CHECK ("quantity_delta" <> 0),
    CONSTRAINT "inventory_movements_type_sign"
      CHECK (
        (
          "movement_type" IN (
            'RECEIVE',
            'TRANSFER_IN',
            'ADJUSTMENT_IN',
            'RETURN_IN',
            'STOCK_COUNT_ADJUSTMENT_IN',
            'OPENING_BALANCE'
          )
          AND "quantity_delta" > 0
        )
        OR (
          "movement_type" IN (
            'ISSUE',
            'TRANSFER_OUT',
            'ADJUSTMENT_OUT',
            'RETURN_OUT',
            'STOCK_COUNT_ADJUSTMENT_OUT'
          )
          AND "quantity_delta" < 0
        )
        OR (
          "movement_type" = 'SYSTEM_CORRECTION'
          AND "quantity_delta" <> 0
        )
      )
);

CREATE UNIQUE INDEX "inventory_movements_id_company_id_key"
  ON "inventory_movements"("id", "company_id");
CREATE UNIQUE INDEX "inventory_movements_company_source_line_type_key"
  ON "inventory_movements"("company_id", "source_type", "source_line_id", "movement_type");
CREATE INDEX "inventory_movements_company_id_occurred_at_idx"
  ON "inventory_movements"("company_id", "occurred_at");
CREATE INDEX "inventory_movements_company_id_sku_id_occurred_at_idx"
  ON "inventory_movements"("company_id", "sku_id", "occurred_at");
CREATE INDEX "inventory_movements_company_id_warehouse_id_occurred_at_idx"
  ON "inventory_movements"("company_id", "warehouse_id", "occurred_at");
CREATE INDEX "inventory_movements_company_id_location_id_occurred_at_idx"
  ON "inventory_movements"("company_id", "location_id", "occurred_at");
CREATE INDEX "inventory_movements_company_id_batch_id_occurred_at_idx"
  ON "inventory_movements"("company_id", "batch_id", "occurred_at");
CREATE INDEX "inventory_movements_company_id_source_type_source_id_idx"
  ON "inventory_movements"("company_id", "source_type", "source_id");
CREATE INDEX "inventory_movements_company_id_operation_id_idx"
  ON "inventory_movements"("company_id", "operation_id");

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_location_company_warehouse_fkey"
  FOREIGN KEY ("location_id", "company_id", "warehouse_id")
  REFERENCES "warehouse_locations"("id", "company_id", "warehouse_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_reversal_of_company_fkey"
  FOREIGN KEY ("reversal_of_movement_id", "company_id")
  REFERENCES "inventory_movements"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "inventory_balances" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "on_hand_quantity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_balances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_balances_on_hand_non_negative"
      CHECK ("on_hand_quantity" >= 0)
);

CREATE UNIQUE INDEX "inventory_balances_id_company_id_key"
  ON "inventory_balances"("id", "company_id");
CREATE UNIQUE INDEX "inventory_balances_position_key"
  ON "inventory_balances"("company_id", "warehouse_id", "location_id", "sku_id", "batch_id");
CREATE INDEX "inventory_balances_company_id_sku_id_idx"
  ON "inventory_balances"("company_id", "sku_id");
CREATE INDEX "inventory_balances_company_id_warehouse_id_idx"
  ON "inventory_balances"("company_id", "warehouse_id");
CREATE INDEX "inventory_balances_company_id_location_id_idx"
  ON "inventory_balances"("company_id", "location_id");
CREATE INDEX "inventory_balances_company_id_batch_id_idx"
  ON "inventory_balances"("company_id", "batch_id");

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_location_company_warehouse_fkey"
  FOREIGN KEY ("location_id", "company_id", "warehouse_id")
  REFERENCES "warehouse_locations"("id", "company_id", "warehouse_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
