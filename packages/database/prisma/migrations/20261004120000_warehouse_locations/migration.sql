-- Phase 3.3 Warehouse Locations (flexible adjacency-list hierarchy)

CREATE TYPE "warehouse_location_type" AS ENUM ('ZONE', 'AISLE', 'RACK', 'SHELF', 'BIN');

CREATE TABLE "warehouse_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "parent_id" UUID,
    "type" "warehouse_location_type" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT,
    "barcode" TEXT NOT NULL,
    "status" "warehouse_status" NOT NULL DEFAULT 'ACTIVE',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouse_locations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "warehouse_locations_no_self_parent_check"
      CHECK ("parent_id" IS NULL OR "parent_id" <> "id")
);

-- Unique keys required before self-referencing / composite FKs.
CREATE UNIQUE INDEX "warehouse_locations_id_company_id_key"
  ON "warehouse_locations"("id", "company_id");

CREATE UNIQUE INDEX "warehouse_locations_id_company_id_warehouse_id_key"
  ON "warehouse_locations"("id", "company_id", "warehouse_id");

CREATE UNIQUE INDEX "warehouse_locations_company_id_warehouse_id_code_key"
  ON "warehouse_locations"("company_id", "warehouse_id", "code");

CREATE UNIQUE INDEX "warehouse_locations_barcode_key"
  ON "warehouse_locations"("barcode");

ALTER TABLE "warehouse_locations"
  ADD CONSTRAINT "warehouse_locations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouse_locations"
  ADD CONSTRAINT "warehouse_locations_warehouse_company_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "warehouse_locations"
  ADD CONSTRAINT "warehouse_locations_parent_same_warehouse_fkey"
  FOREIGN KEY ("parent_id", "company_id", "warehouse_id")
  REFERENCES "warehouse_locations"("id", "company_id", "warehouse_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "warehouse_locations_company_id_warehouse_id_idx"
  ON "warehouse_locations"("company_id", "warehouse_id");

CREATE INDEX "warehouse_locations_warehouse_id_parent_id_idx"
  ON "warehouse_locations"("warehouse_id", "parent_id");

CREATE INDEX "warehouse_locations_warehouse_id_status_idx"
  ON "warehouse_locations"("warehouse_id", "status");

CREATE INDEX "warehouse_locations_warehouse_id_type_idx"
  ON "warehouse_locations"("warehouse_id", "type");

CREATE INDEX "warehouse_locations_company_id_barcode_idx"
  ON "warehouse_locations"("company_id", "barcode");
