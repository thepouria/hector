-- Phase 3.12: Stock Classification + Manual Stock Issue (non-sales outbound).

CREATE TYPE "stock_classification" AS ENUM (
  'SELLABLE',
  'TESTER',
  'DAMAGED',
  'QUARANTINE'
);

CREATE TYPE "stock_issue_reason" AS ENUM (
  'COMPANY_USE',
  'SAMPLE',
  'DAMAGE',
  'MANUAL',
  'OTHER'
);

CREATE TYPE "stock_issue_status" AS ENUM (
  'DRAFT',
  'POSTED',
  'CANCELLED'
);

ALTER TYPE "inventory_movement_type" ADD VALUE IF NOT EXISTS 'RECLASSIFY_OUT';
ALTER TYPE "inventory_movement_type" ADD VALUE IF NOT EXISTS 'RECLASSIFY_IN';

ALTER TYPE "inventory_source_type" ADD VALUE IF NOT EXISTS 'CLASSIFICATION_CHANGE';
ALTER TYPE "inventory_source_type" ADD VALUE IF NOT EXISTS 'STOCK_ISSUE';

-- New enum values must be committed before use in CHECK; PostgreSQL allows ADD VALUE
-- then ALTER CHECK in the same migration when using IF NOT EXISTS + drop/recreate.

-- Classification on ledger + balances (backfill SELLABLE for existing inventory).
ALTER TABLE "inventory_movements"
  ADD COLUMN "classification" "stock_classification" NOT NULL DEFAULT 'SELLABLE';

ALTER TABLE "inventory_balances"
  ADD COLUMN "classification" "stock_classification" NOT NULL DEFAULT 'SELLABLE';

ALTER TABLE "stock_transfer_items"
  ADD COLUMN "classification" "stock_classification" NOT NULL DEFAULT 'SELLABLE';

-- Drop defaults after backfill so new writers must set classification explicitly
-- (Prisma still defaults SELLABLE for convenience on create).
-- Keep DEFAULT for safe inserts from older code paths during rollout.

CREATE INDEX "inventory_movements_company_id_classification_occurred_at_idx"
  ON "inventory_movements"("company_id", "classification", "occurred_at");

-- Recreate movement type/sign CHECK to include RECLASSIFY_*.
ALTER TABLE "inventory_movements"
  DROP CONSTRAINT IF EXISTS "inventory_movements_type_sign";

ALTER TABLE "inventory_movements"
  ADD CONSTRAINT "inventory_movements_type_sign"
  CHECK (
    (
      "movement_type" IN (
        'RECEIVE',
        'TRANSFER_IN',
        'RECLASSIFY_IN',
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
        'RECLASSIFY_OUT',
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
  );

-- Balance uniqueness: include classification.
ALTER TABLE "inventory_balances"
  DROP CONSTRAINT IF EXISTS "inventory_balances_company_id_warehouse_id_location_id_sku_id_batch_id_key";

DROP INDEX IF EXISTS "inventory_balances_company_id_warehouse_id_location_id_sku_id_batch_id_key";
DROP INDEX IF EXISTS "inventory_balances_position_key";

CREATE UNIQUE INDEX "inventory_balances_company_wh_loc_sku_batch_class_key"
  ON "inventory_balances"(
    "company_id",
    "warehouse_id",
    "location_id",
    "sku_id",
    "batch_id",
    "classification"
  );

CREATE INDEX "inventory_balances_company_id_sku_id_classification_idx"
  ON "inventory_balances"("company_id", "sku_id", "classification");
CREATE INDEX "inventory_balances_company_id_warehouse_id_classification_idx"
  ON "inventory_balances"("company_id", "warehouse_id", "classification");
CREATE INDEX "inventory_balances_company_id_location_id_classification_idx"
  ON "inventory_balances"("company_id", "location_id", "classification");
CREATE INDEX "inventory_balances_company_id_classification_idx"
  ON "inventory_balances"("company_id", "classification");

-- Transfer item uniqueness: include classification.
ALTER TABLE "stock_transfer_items"
  DROP CONSTRAINT IF EXISTS "stock_transfer_items_transfer_id_sku_id_batch_id_source_location_id_destination_location_id_key";

DROP INDEX IF EXISTS "stock_transfer_items_transfer_id_sku_id_batch_id_source_location_id_destination_location_id_key";

CREATE UNIQUE INDEX "stock_transfer_items_xfer_sku_batch_class_locs_key"
  ON "stock_transfer_items"(
    "transfer_id",
    "sku_id",
    "batch_id",
    "classification",
    "source_location_id",
    "destination_location_id"
  );

CREATE INDEX "stock_transfer_items_classification_idx"
  ON "stock_transfer_items"("classification");

-- Classification change documents (immediate post; no draft lifecycle).
CREATE TABLE "stock_classification_changes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "from_classification" "stock_classification" NOT NULL,
    "to_classification" "stock_classification" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "operation_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_classification_changes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_classification_changes_quantity_positive"
      CHECK ("quantity" > 0),
    CONSTRAINT "stock_classification_changes_from_ne_to"
      CHECK ("from_classification" <> "to_classification")
);

CREATE UNIQUE INDEX "stock_classification_changes_id_company_id_key"
  ON "stock_classification_changes"("id", "company_id");
CREATE INDEX "stock_classification_changes_company_id_sku_id_idx"
  ON "stock_classification_changes"("company_id", "sku_id");
CREATE INDEX "stock_classification_changes_company_id_warehouse_id_idx"
  ON "stock_classification_changes"("company_id", "warehouse_id");
CREATE INDEX "stock_classification_changes_company_id_created_at_idx"
  ON "stock_classification_changes"("company_id", "created_at");
CREATE INDEX "stock_classification_changes_company_id_operation_id_idx"
  ON "stock_classification_changes"("company_id", "operation_id");

ALTER TABLE "stock_classification_changes"
  ADD CONSTRAINT "stock_classification_changes_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_classification_changes"
  ADD CONSTRAINT "stock_classification_changes_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_classification_changes"
  ADD CONSTRAINT "stock_classification_changes_location_company_warehouse_fkey"
  FOREIGN KEY ("location_id", "company_id", "warehouse_id")
  REFERENCES "warehouse_locations"("id", "company_id", "warehouse_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_classification_changes"
  ADD CONSTRAINT "stock_classification_changes_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_classification_changes"
  ADD CONSTRAINT "stock_classification_changes_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_classification_changes"
  ADD CONSTRAINT "stock_classification_changes_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stock Issue sequence + documents.
CREATE TABLE "stock_issue_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "stock_issue_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "stock_issue_sequences"
  ADD CONSTRAINT "stock_issue_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_issues" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "warehouse_id" UUID NOT NULL,
    "reason" "stock_issue_reason" NOT NULL,
    "reason_text" TEXT,
    "notes" TEXT,
    "status" "stock_issue_status" NOT NULL DEFAULT 'DRAFT',
    "posted_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "posted_by_id" UUID,
    "cancelled_by_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_issues_manual_other_reason_text"
      CHECK (
        ("reason" NOT IN ('MANUAL', 'OTHER'))
        OR ("reason_text" IS NOT NULL AND length(btrim("reason_text")) > 0)
      )
);

CREATE UNIQUE INDEX "stock_issues_id_company_id_key" ON "stock_issues"("id", "company_id");
CREATE UNIQUE INDEX "stock_issues_company_id_number_key" ON "stock_issues"("company_id", "number");
CREATE INDEX "stock_issues_company_id_status_idx" ON "stock_issues"("company_id", "status");
CREATE INDEX "stock_issues_company_id_warehouse_id_idx" ON "stock_issues"("company_id", "warehouse_id");
CREATE INDEX "stock_issues_company_id_reason_idx" ON "stock_issues"("company_id", "reason");
CREATE INDEX "stock_issues_company_id_created_at_idx" ON "stock_issues"("company_id", "created_at");

ALTER TABLE "stock_issues"
  ADD CONSTRAINT "stock_issues_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issues"
  ADD CONSTRAINT "stock_issues_warehouse_id_company_id_fkey"
  FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issues"
  ADD CONSTRAINT "stock_issues_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issues"
  ADD CONSTRAINT "stock_issues_posted_by_id_fkey"
  FOREIGN KEY ("posted_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issues"
  ADD CONSTRAINT "stock_issues_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_issue_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "stock_issue_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "classification" "stock_classification" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_issue_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_issue_items_quantity_positive"
      CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "stock_issue_items_id_company_id_key"
  ON "stock_issue_items"("id", "company_id");
CREATE UNIQUE INDEX "stock_issue_items_issue_position_key"
  ON "stock_issue_items"(
    "stock_issue_id",
    "sku_id",
    "batch_id",
    "location_id",
    "classification"
  );
CREATE INDEX "stock_issue_items_stock_issue_id_idx" ON "stock_issue_items"("stock_issue_id");
CREATE INDEX "stock_issue_items_company_id_sku_id_idx" ON "stock_issue_items"("company_id", "sku_id");
CREATE INDEX "stock_issue_items_batch_id_idx" ON "stock_issue_items"("batch_id");
CREATE INDEX "stock_issue_items_location_id_idx" ON "stock_issue_items"("location_id");
CREATE INDEX "stock_issue_items_classification_idx" ON "stock_issue_items"("classification");

ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "stock_issue_items_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "stock_issue_items_stock_issue_id_company_id_fkey"
  FOREIGN KEY ("stock_issue_id", "company_id") REFERENCES "stock_issues"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "stock_issue_items_sku_id_company_id_fkey"
  FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "stock_issue_items_batch_id_company_id_fkey"
  FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issue_items"
  ADD CONSTRAINT "stock_issue_items_location_id_company_id_fkey"
  FOREIGN KEY ("location_id", "company_id") REFERENCES "warehouse_locations"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_issue_scan_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "stock_issue_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_issue_scan_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_issue_scan_requests_company_issue_request_key"
  ON "stock_issue_scan_requests"("company_id", "stock_issue_id", "request_id");
CREATE INDEX "stock_issue_scan_requests_stock_issue_id_idx"
  ON "stock_issue_scan_requests"("stock_issue_id");

ALTER TABLE "stock_issue_scan_requests"
  ADD CONSTRAINT "stock_issue_scan_requests_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_issue_scan_requests"
  ADD CONSTRAINT "stock_issue_scan_requests_stock_issue_id_company_id_fkey"
  FOREIGN KEY ("stock_issue_id", "company_id") REFERENCES "stock_issues"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
