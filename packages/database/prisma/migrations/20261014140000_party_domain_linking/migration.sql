-- Phase 5.5.2 — Party domain linking (nullable FKs first; backfill via party:migrate)

CREATE TYPE "partner_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');
CREATE TYPE "party_relationship_type" AS ENUM ('CONTACT_FOR');
CREATE TYPE "party_relationship_status" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "party_migration_source_type" AS ENUM (
  'SUPPLIER',
  'CUSTOMER',
  'SUPPLIER_CONTACT',
  'LOAN_LENDER',
  'CAPITAL_CONTRIBUTOR',
  'PARTNER'
);
CREATE TYPE "party_migration_match_tier" AS ENUM (
  'CREATED_NEW',
  'STRONG_IDENTITY',
  'CONTACT_MATCH',
  'EXPLICIT_LINK',
  'AMBIGUOUS_SEPARATE'
);

-- Minimal Partner relationship (ownership management deferred to Phase 10).
CREATE TABLE "partners" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "party_id" UUID NOT NULL,
  "code" TEXT,
  "status" "partner_status" NOT NULL DEFAULT 'ACTIVE',
  "ownership_percent" DECIMAL(9, 6),
  "effective_from" TIMESTAMPTZ(3),
  "effective_to" TIMESTAMPTZ(3),
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  "archived_at" TIMESTAMPTZ(3),
  CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_relationships" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "from_party_id" UUID NOT NULL,
  "to_party_id" UUID NOT NULL,
  "type" "party_relationship_type" NOT NULL,
  "status" "party_relationship_status" NOT NULL DEFAULT 'ACTIVE',
  "job_title" TEXT,
  "department" TEXT,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "party_relationships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "party_migration_maps" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "source_type" "party_migration_source_type" NOT NULL,
  "source_id" UUID NOT NULL,
  "party_id" UUID NOT NULL,
  "match_tier" "party_migration_match_tier" NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "party_migration_maps_pkey" PRIMARY KEY ("id")
);

-- Domain FKs (nullable until backfill)
ALTER TABLE "suppliers" ADD COLUMN "party_id" UUID;
ALTER TABLE "customers" ADD COLUMN "party_id" UUID;
ALTER TABLE "loans" ADD COLUMN "lender_party_id" UUID;
ALTER TABLE "loans" ADD COLUMN "borrower_party_id" UUID;
ALTER TABLE "capital_contributions" ADD COLUMN "contributor_party_id" UUID;
ALTER TABLE "supplier_contacts" ADD COLUMN "contact_party_id" UUID;

-- Uniques needed before composite FKs
CREATE UNIQUE INDEX "partners_id_company_id_key" ON "partners"("id", "company_id");
CREATE UNIQUE INDEX "party_relationships_id_company_id_key" ON "party_relationships"("id", "company_id");

CREATE UNIQUE INDEX "partners_company_party_unique"
  ON "partners"("company_id", "party_id");
CREATE UNIQUE INDEX "partners_company_code_key"
  ON "partners"("company_id", "code")
  WHERE "code" IS NOT NULL;

CREATE UNIQUE INDEX "party_relationships_active_unique"
  ON "party_relationships"("company_id", "from_party_id", "to_party_id", "type")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "party_migration_maps_source_unique"
  ON "party_migration_maps"("company_id", "source_type", "source_id");

CREATE UNIQUE INDEX "suppliers_company_party_unique"
  ON "suppliers"("company_id", "party_id")
  WHERE "party_id" IS NOT NULL;
CREATE UNIQUE INDEX "customers_company_party_unique"
  ON "customers"("company_id", "party_id")
  WHERE "party_id" IS NOT NULL;

CREATE INDEX "suppliers_party_id_idx" ON "suppliers"("party_id");
CREATE INDEX "customers_party_id_idx" ON "customers"("party_id");
CREATE INDEX "loans_lender_party_id_idx" ON "loans"("lender_party_id");
CREATE INDEX "loans_borrower_party_id_idx" ON "loans"("borrower_party_id");
CREATE INDEX "capital_contributions_contributor_party_id_idx" ON "capital_contributions"("contributor_party_id");
CREATE INDEX "supplier_contacts_contact_party_id_idx" ON "supplier_contacts"("contact_party_id");
CREATE INDEX "partners_company_status_idx" ON "partners"("company_id", "status");
CREATE INDEX "party_relationships_company_to_idx" ON "party_relationships"("company_id", "to_party_id");
CREATE INDEX "party_relationships_company_from_idx" ON "party_relationships"("company_id", "from_party_id");

-- FKs
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partners"
  ADD CONSTRAINT "partners_party_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_relationships"
  ADD CONSTRAINT "party_relationships_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_relationships"
  ADD CONSTRAINT "party_relationships_from_party_fkey"
  FOREIGN KEY ("from_party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_relationships"
  ADD CONSTRAINT "party_relationships_to_party_fkey"
  FOREIGN KEY ("to_party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "party_migration_maps"
  ADD CONSTRAINT "party_migration_maps_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_migration_maps"
  ADD CONSTRAINT "party_migration_maps_party_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_party_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_party_company_fkey"
  FOREIGN KEY ("party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "loans"
  ADD CONSTRAINT "loans_lender_party_company_fkey"
  FOREIGN KEY ("lender_party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "loans"
  ADD CONSTRAINT "loans_borrower_party_company_fkey"
  FOREIGN KEY ("borrower_party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capital_contributions"
  ADD CONSTRAINT "capital_contributions_contributor_party_company_fkey"
  FOREIGN KEY ("contributor_party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_contacts"
  ADD CONSTRAINT "supplier_contacts_contact_party_company_fkey"
  FOREIGN KEY ("contact_party_id", "company_id") REFERENCES "parties"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;
