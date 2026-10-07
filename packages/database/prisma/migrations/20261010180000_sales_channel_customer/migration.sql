-- Phase 5.1 Sales Channel + Customer Master

CREATE TYPE "sales_channel_type" AS ENUM ('WEBSITE', 'MARKETPLACE', 'WHOLESALE', 'MANUAL', 'OTHER');
CREATE TYPE "sales_channel_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "customer_type" AS ENUM ('INDIVIDUAL', 'BUSINESS');
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "sales_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "sales_channel_type" NOT NULL,
    "status" "sales_channel_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "sales_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT,
    "type" "customer_type" NOT NULL,
    "display_name" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "business_name" TEXT,
    "mobile" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "national_id" TEXT,
    "tax_id" TEXT,
    "registration_number" TEXT,
    "status" "customer_status" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "created_by_id" UUID,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "label" TEXT,
    "recipient_name" TEXT,
    "mobile" TEXT,
    "province" TEXT,
    "city" TEXT,
    "address_line" TEXT,
    "postal_code" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "customer_addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sales_channels_id_company_id_key" ON "sales_channels"("id", "company_id");
CREATE UNIQUE INDEX "sales_channels_company_id_code_key" ON "sales_channels"("company_id", "code");
CREATE INDEX "sales_channels_company_id_status_idx" ON "sales_channels"("company_id", "status");
CREATE INDEX "sales_channels_company_id_type_idx" ON "sales_channels"("company_id", "type");

CREATE UNIQUE INDEX "customers_id_company_id_key" ON "customers"("id", "company_id");
CREATE UNIQUE INDEX "customers_company_id_code_key" ON "customers"("company_id", "code");
CREATE INDEX "customers_company_id_status_idx" ON "customers"("company_id", "status");
CREATE INDEX "customers_company_id_type_idx" ON "customers"("company_id", "type");
CREATE INDEX "customers_company_id_display_name_idx" ON "customers"("company_id", "display_name");
CREATE INDEX "customers_company_id_mobile_idx" ON "customers"("company_id", "mobile");

CREATE UNIQUE INDEX "customer_addresses_id_company_id_key" ON "customer_addresses"("id", "company_id");
CREATE INDEX "customer_addresses_company_id_customer_id_idx" ON "customer_addresses"("company_id", "customer_id");

-- At most one active default address per customer (DB-enforced concurrency).
CREATE UNIQUE INDEX "customer_addresses_one_default_active"
  ON "customer_addresses" ("customer_id")
  WHERE "is_default" = true AND "archived_at" IS NULL;

ALTER TABLE "sales_channels"
  ADD CONSTRAINT "sales_channels_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales_channels"
  ADD CONSTRAINT "sales_channels_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_addresses"
  ADD CONSTRAINT "customer_addresses_customer_id_company_id_fkey"
  FOREIGN KEY ("customer_id", "company_id") REFERENCES "customers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
