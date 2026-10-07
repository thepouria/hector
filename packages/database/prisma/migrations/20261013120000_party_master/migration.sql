-- Phase 5.5.1 — Party Master (identity foundation; no Supplier/Customer links yet)

CREATE TYPE "party_type" AS ENUM ('INDIVIDUAL', 'ORGANIZATION');
CREATE TYPE "party_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "party_contact_point_type" AS ENUM (
  'MOBILE',
  'PHONE',
  'EMAIL',
  'WHATSAPP',
  'TELEGRAM',
  'WEBSITE',
  'OTHER'
);
CREATE TYPE "party_contact_point_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "party_address_type" AS ENUM (
  'GENERAL',
  'BILLING',
  'SHIPPING',
  'OFFICE',
  'WAREHOUSE',
  'HOME',
  'OTHER'
);
CREATE TYPE "party_role_type" AS ENUM (
  'SUPPLIER',
  'CUSTOMER',
  'PARTNER',
  'LENDER',
  'BORROWER',
  'CONTACT',
  'EMPLOYEE',
  'OTHER'
);
CREATE TYPE "party_role_status" AS ENUM ('ACTIVE', 'INACTIVE');

CREATE TABLE "party_sequences" (
  "company_id" UUID NOT NULL,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "party_sequences_pkey" PRIMARY KEY ("company_id")
);

CREATE TABLE "parties" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "party_code" TEXT NOT NULL,
  "type" "party_type" NOT NULL,
  "status" "party_status" NOT NULL DEFAULT 'ACTIVE',
  "display_name" TEXT NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT,
  "birth_date" DATE,
  "legal_name" TEXT,
  "trade_name" TEXT,
  "national_id" TEXT,
  "registration_number" TEXT,
  "tax_id" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  "created_by_id" UUID,
  "updated_by_id" UUID,
  CONSTRAINT "parties_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_contact_points" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "party_id" UUID NOT NULL,
  "type" "party_contact_point_type" NOT NULL,
  "value" TEXT NOT NULL,
  "normalized_value" TEXT NOT NULL,
  "label" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "status" "party_contact_point_status" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "party_contact_points_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_addresses" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "party_id" UUID NOT NULL,
  "label" TEXT,
  "type" "party_address_type" NOT NULL DEFAULT 'GENERAL',
  "country" TEXT,
  "province" TEXT,
  "city" TEXT,
  "district" TEXT,
  "postal_code" TEXT,
  "address_line1" TEXT NOT NULL,
  "address_line2" TEXT,
  "recipient_name" TEXT,
  "recipient_phone" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "party_addresses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_roles" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "party_id" UUID NOT NULL,
  "role_type" "party_role_type" NOT NULL,
  "status" "party_role_status" NOT NULL DEFAULT 'ACTIVE',
  "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "party_roles_pkey" PRIMARY KEY ("id")
);

-- Composite uniques MUST exist before composite FKs (Postgres).
CREATE UNIQUE INDEX "parties_id_company_id_key" ON "parties"("id", "company_id");
CREATE UNIQUE INDEX "parties_company_id_party_code_key" ON "parties"("company_id", "party_code");
CREATE UNIQUE INDEX "party_contact_points_id_company_id_key" ON "party_contact_points"("id", "company_id");
CREATE UNIQUE INDEX "party_addresses_id_company_id_key" ON "party_addresses"("id", "company_id");
CREATE UNIQUE INDEX "party_roles_id_company_id_key" ON "party_roles"("id", "company_id");

-- FKs
ALTER TABLE "party_sequences"
  ADD CONSTRAINT "party_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "parties"
  ADD CONSTRAINT "parties_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "parties"
  ADD CONSTRAINT "parties_updated_by_id_fkey"
  FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_contact_points"
  ADD CONSTRAINT "party_contact_points_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_contact_points"
  ADD CONSTRAINT "party_contact_points_party_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_addresses"
  ADD CONSTRAINT "party_addresses_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_addresses"
  ADD CONSTRAINT "party_addresses_party_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_roles"
  ADD CONSTRAINT "party_roles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_roles"
  ADD CONSTRAINT "party_roles_party_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Supporting indexes
CREATE INDEX "parties_company_id_status_idx" ON "parties"("company_id", "status");
CREATE INDEX "parties_company_id_type_idx" ON "parties"("company_id", "type");
CREATE INDEX "parties_company_id_display_name_idx" ON "parties"("company_id", "display_name");
CREATE INDEX "parties_company_id_national_id_idx" ON "parties"("company_id", "national_id");
CREATE INDEX "parties_company_id_registration_number_idx" ON "parties"("company_id", "registration_number");
CREATE INDEX "parties_company_id_updated_at_idx" ON "parties"("company_id", "updated_at");

CREATE UNIQUE INDEX "parties_company_national_id_unique"
  ON "parties"("company_id", "national_id")
  WHERE "national_id" IS NOT NULL;
CREATE UNIQUE INDEX "parties_company_registration_number_unique"
  ON "parties"("company_id", "registration_number")
  WHERE "registration_number" IS NOT NULL;

CREATE INDEX "party_contact_points_company_id_party_id_idx" ON "party_contact_points"("company_id", "party_id");
CREATE INDEX "party_contact_points_company_type_normalized_idx"
  ON "party_contact_points"("company_id", "type", "normalized_value");
CREATE INDEX "party_contact_points_party_type_primary_idx"
  ON "party_contact_points"("party_id", "type", "is_primary");

CREATE UNIQUE INDEX "party_contact_one_primary_per_type"
  ON "party_contact_points"("company_id", "party_id", "type")
  WHERE "is_primary" = true AND "status" = 'ACTIVE';

CREATE INDEX "party_addresses_company_id_party_id_idx" ON "party_addresses"("company_id", "party_id");
CREATE INDEX "party_addresses_party_id_is_primary_idx" ON "party_addresses"("party_id", "is_primary");

CREATE UNIQUE INDEX "party_address_one_primary"
  ON "party_addresses"("company_id", "party_id")
  WHERE "is_primary" = true AND "archived_at" IS NULL;

CREATE INDEX "party_roles_company_id_party_id_idx" ON "party_roles"("company_id", "party_id");
CREATE INDEX "party_roles_company_role_status_idx" ON "party_roles"("company_id", "role_type", "status");
CREATE INDEX "party_roles_party_role_status_idx" ON "party_roles"("party_id", "role_type", "status");

CREATE UNIQUE INDEX "party_role_one_active_per_type"
  ON "party_roles"("company_id", "party_id", "role_type")
  WHERE "status" = 'ACTIVE';
