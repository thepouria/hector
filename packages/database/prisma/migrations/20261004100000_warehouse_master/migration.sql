-- Phase 3.2 Warehouse Master

CREATE TYPE "warehouse_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "warehouses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "warehouse_status" NOT NULL DEFAULT 'ACTIVE',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "address" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "warehouses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "warehouses_default_must_be_active_check"
      CHECK ("is_default" = false OR "status" = 'ACTIVE')
);

ALTER TABLE "warehouses"
  ADD CONSTRAINT "warehouses_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "warehouses_id_company_id_key"
  ON "warehouses"("id", "company_id");

CREATE UNIQUE INDEX "warehouses_company_id_code_key"
  ON "warehouses"("company_id", "code");

-- At most one default warehouse per company (concurrency-safe).
CREATE UNIQUE INDEX "warehouses_one_default_per_company"
  ON "warehouses"("company_id")
  WHERE "is_default" = true;

CREATE INDEX "warehouses_company_id_status_idx"
  ON "warehouses"("company_id", "status");

CREATE INDEX "warehouses_company_id_name_idx"
  ON "warehouses"("company_id", "name");

CREATE INDEX "warehouses_company_id_is_default_idx"
  ON "warehouses"("company_id", "is_default");
