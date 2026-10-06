-- Phase 3.13: Inventory Adjustments + Stock Counts (movement-aware).

CREATE TYPE "inventory_adjustment_reason" AS ENUM (
  'FOUND',
  'MISSING',
  'REGISTRATION_ERROR',
  'CORRECTION',
  'OTHER'
);

CREATE TYPE "inventory_adjustment_status" AS ENUM (
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE "inventory_adjustment_direction" AS ENUM (
  'IN',
  'OUT'
);

CREATE TYPE "stock_count_type" AS ENUM (
  'FULL',
  'CYCLE'
);

CREATE TYPE "stock_count_status" AS ENUM (
  'DRAFT',
  'IN_PROGRESS',
  'SUBMITTED',
  'RECOUNT_REQUIRED',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'CANCELLED'
);

CREATE TYPE "stock_count_line_status" AS ENUM (
  'PENDING',
  'COUNTED',
  'SKIPPED',
  'RECOUNT_REQUIRED'
);

CREATE TABLE "inventory_adjustment_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "inventory_adjustment_sequences_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "inventory_adjustment_sequences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "inventory_adjustments" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "reason" "inventory_adjustment_reason" NOT NULL,
  "reason_text" TEXT,
  "notes" TEXT,
  "status" "inventory_adjustment_status" NOT NULL DEFAULT 'DRAFT',
  "submitted_at" TIMESTAMPTZ(3),
  "approved_at" TIMESTAMPTZ(3),
  "rejected_at" TIMESTAMPTZ(3),
  "posted_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "approved_by_id" UUID,
  "rejected_by_id" UUID,
  "posted_by_id" UUID,
  "cancelled_by_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "inventory_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_adjustments_quantity_version_positive"
    CHECK ("version" >= 1),
  CONSTRAINT "inventory_adjustments_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_warehouse_company_fkey"
    FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_rejected_by_id_fkey"
    FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_posted_by_id_fkey"
    FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustments_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_adjustments_id_company_id_key"
  ON "inventory_adjustments"("id", "company_id");
CREATE UNIQUE INDEX "inventory_adjustments_company_id_number_key"
  ON "inventory_adjustments"("company_id", "number");
CREATE INDEX "inventory_adjustments_company_id_status_idx"
  ON "inventory_adjustments"("company_id", "status");
CREATE INDEX "inventory_adjustments_company_id_warehouse_id_idx"
  ON "inventory_adjustments"("company_id", "warehouse_id");
CREATE INDEX "inventory_adjustments_company_id_reason_idx"
  ON "inventory_adjustments"("company_id", "reason");
CREATE INDEX "inventory_adjustments_company_id_created_at_idx"
  ON "inventory_adjustments"("company_id", "created_at");

CREATE TABLE "inventory_adjustment_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "inventory_adjustment_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "classification" "stock_classification" NOT NULL,
  "direction" "inventory_adjustment_direction" NOT NULL,
  "quantity" INTEGER NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "inventory_adjustment_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_adjustment_items_quantity_positive"
    CHECK ("quantity" > 0),
  CONSTRAINT "inventory_adjustment_items_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustment_items_adjustment_company_fkey"
    FOREIGN KEY ("inventory_adjustment_id", "company_id")
      REFERENCES "inventory_adjustments"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustment_items_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustment_items_batch_company_fkey"
    FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_adjustment_items_location_company_fkey"
    FOREIGN KEY ("location_id", "company_id")
      REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "inventory_adjustment_items_id_company_id_key"
  ON "inventory_adjustment_items"("id", "company_id");
CREATE UNIQUE INDEX "inventory_adjustment_items_position_direction_key"
  ON "inventory_adjustment_items"(
    "inventory_adjustment_id",
    "location_id",
    "sku_id",
    "batch_id",
    "classification",
    "direction"
  );
CREATE INDEX "inventory_adjustment_items_inventory_adjustment_id_idx"
  ON "inventory_adjustment_items"("inventory_adjustment_id");
CREATE INDEX "inventory_adjustment_items_company_id_sku_id_idx"
  ON "inventory_adjustment_items"("company_id", "sku_id");
CREATE INDEX "inventory_adjustment_items_location_id_idx"
  ON "inventory_adjustment_items"("location_id");
CREATE INDEX "inventory_adjustment_items_batch_id_idx"
  ON "inventory_adjustment_items"("batch_id");
CREATE INDEX "inventory_adjustment_items_classification_idx"
  ON "inventory_adjustment_items"("classification");

CREATE TABLE "stock_count_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "stock_count_sequences_pkey" PRIMARY KEY ("company_id"),
  CONSTRAINT "stock_count_sequences_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "stock_counts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "type" "stock_count_type" NOT NULL,
  "status" "stock_count_status" NOT NULL DEFAULT 'DRAFT',
  "blind_count" BOOLEAN NOT NULL DEFAULT false,
  "allow_discovered_items" BOOLEAN NOT NULL DEFAULT false,
  "scope_classifications" "stock_classification"[] NOT NULL DEFAULT ARRAY[]::"stock_classification"[],
  "high_difference_threshold" INTEGER,
  "notes" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "submitted_at" TIMESTAMPTZ(3),
  "recount_requested_at" TIMESTAMPTZ(3),
  "approved_at" TIMESTAMPTZ(3),
  "rejected_at" TIMESTAMPTZ(3),
  "posted_at" TIMESTAMPTZ(3),
  "cancelled_at" TIMESTAMPTZ(3),
  "created_by_id" UUID NOT NULL,
  "started_by_id" UUID,
  "submitted_by_id" UUID,
  "approved_by_id" UUID,
  "rejected_by_id" UUID,
  "posted_by_id" UUID,
  "cancelled_by_id" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "stock_counts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_counts_version_positive" CHECK ("version" >= 1),
  CONSTRAINT "stock_counts_high_diff_threshold_nonneg"
    CHECK ("high_difference_threshold" IS NULL OR "high_difference_threshold" >= 0),
  CONSTRAINT "stock_counts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_warehouse_company_fkey"
    FOREIGN KEY ("warehouse_id", "company_id") REFERENCES "warehouses"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_created_by_id_fkey"
    FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_started_by_id_fkey"
    FOREIGN KEY ("started_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_submitted_by_id_fkey"
    FOREIGN KEY ("submitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_approved_by_id_fkey"
    FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_rejected_by_id_fkey"
    FOREIGN KEY ("rejected_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_posted_by_id_fkey"
    FOREIGN KEY ("posted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_counts_cancelled_by_id_fkey"
    FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stock_counts_id_company_id_key"
  ON "stock_counts"("id", "company_id");
CREATE UNIQUE INDEX "stock_counts_company_id_number_key"
  ON "stock_counts"("company_id", "number");
CREATE INDEX "stock_counts_company_id_status_idx"
  ON "stock_counts"("company_id", "status");
CREATE INDEX "stock_counts_company_id_warehouse_id_idx"
  ON "stock_counts"("company_id", "warehouse_id");
CREATE INDEX "stock_counts_company_id_type_idx"
  ON "stock_counts"("company_id", "type");
CREATE INDEX "stock_counts_company_id_created_at_idx"
  ON "stock_counts"("company_id", "created_at");

CREATE TABLE "stock_count_scope_locations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "stock_count_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_count_scope_locations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_scope_locations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_scope_locations_count_company_fkey"
    FOREIGN KEY ("stock_count_id", "company_id")
      REFERENCES "stock_counts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_count_scope_locations_location_company_fkey"
    FOREIGN KEY ("location_id", "company_id")
      REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stock_count_scope_locations_stock_count_id_location_id_key"
  ON "stock_count_scope_locations"("stock_count_id", "location_id");
CREATE INDEX "stock_count_scope_locations_stock_count_id_idx"
  ON "stock_count_scope_locations"("stock_count_id");
CREATE INDEX "stock_count_scope_locations_location_id_idx"
  ON "stock_count_scope_locations"("location_id");

CREATE TABLE "stock_count_scope_skus" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "stock_count_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_count_scope_skus_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_scope_skus_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_scope_skus_count_company_fkey"
    FOREIGN KEY ("stock_count_id", "company_id")
      REFERENCES "stock_counts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_count_scope_skus_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stock_count_scope_skus_stock_count_id_sku_id_key"
  ON "stock_count_scope_skus"("stock_count_id", "sku_id");
CREATE INDEX "stock_count_scope_skus_stock_count_id_idx"
  ON "stock_count_scope_skus"("stock_count_id");
CREATE INDEX "stock_count_scope_skus_sku_id_idx"
  ON "stock_count_scope_skus"("sku_id");

CREATE TABLE "stock_count_items" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "stock_count_id" UUID NOT NULL,
  "warehouse_id" UUID NOT NULL,
  "location_id" UUID NOT NULL,
  "sku_id" UUID NOT NULL,
  "batch_id" UUID NOT NULL,
  "classification" "stock_classification" NOT NULL,
  "snapshot_quantity" INTEGER NOT NULL,
  "counted_quantity" INTEGER,
  "movements_during_count" INTEGER,
  "expected_quantity" INTEGER,
  "difference" INTEGER,
  "line_status" "stock_count_line_status" NOT NULL DEFAULT 'PENDING',
  "is_discovered" BOOLEAN NOT NULL DEFAULT false,
  "counted_by_id" UUID,
  "counted_at" TIMESTAMPTZ(3),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "stock_count_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_items_snapshot_nonneg"
    CHECK ("snapshot_quantity" >= 0),
  CONSTRAINT "stock_count_items_counted_nonneg"
    CHECK ("counted_quantity" IS NULL OR "counted_quantity" >= 0),
  CONSTRAINT "stock_count_items_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_items_count_company_fkey"
    FOREIGN KEY ("stock_count_id", "company_id")
      REFERENCES "stock_counts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "stock_count_items_sku_company_fkey"
    FOREIGN KEY ("sku_id", "company_id") REFERENCES "skus"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_items_batch_company_fkey"
    FOREIGN KEY ("batch_id", "company_id") REFERENCES "batches"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_items_location_company_fkey"
    FOREIGN KEY ("location_id", "company_id")
      REFERENCES "warehouse_locations"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_items_counted_by_id_fkey"
    FOREIGN KEY ("counted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stock_count_items_id_company_id_key"
  ON "stock_count_items"("id", "company_id");
CREATE UNIQUE INDEX "stock_count_items_position_key"
  ON "stock_count_items"(
    "stock_count_id",
    "location_id",
    "sku_id",
    "batch_id",
    "classification"
  );
CREATE INDEX "stock_count_items_stock_count_id_idx"
  ON "stock_count_items"("stock_count_id");
CREATE INDEX "stock_count_items_company_id_sku_id_idx"
  ON "stock_count_items"("company_id", "sku_id");
CREATE INDEX "stock_count_items_location_id_idx"
  ON "stock_count_items"("location_id");
CREATE INDEX "stock_count_items_batch_id_idx"
  ON "stock_count_items"("batch_id");
CREATE INDEX "stock_count_items_classification_idx"
  ON "stock_count_items"("classification");
CREATE INDEX "stock_count_items_line_status_idx"
  ON "stock_count_items"("line_status");

CREATE TABLE "stock_count_scan_requests" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "stock_count_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "response_json" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_count_scan_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_count_scan_requests_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stock_count_scan_requests_count_company_fkey"
    FOREIGN KEY ("stock_count_id", "company_id")
      REFERENCES "stock_counts"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stock_count_scan_requests_company_count_request_key"
  ON "stock_count_scan_requests"("company_id", "stock_count_id", "request_id");
CREATE INDEX "stock_count_scan_requests_stock_count_id_idx"
  ON "stock_count_scan_requests"("stock_count_id");
