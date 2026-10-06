-- Phase 2.2 Supplier Master

CREATE TYPE "purchasing_lifecycle_status" AS ENUM ('ACTIVE', 'INACTIVE', 'ARCHIVED');

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "legal_name" TEXT,
    "code" TEXT,
    "status" "purchasing_lifecycle_status" NOT NULL DEFAULT 'ACTIVE',
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "email" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),

    CONSTRAINT "supplier_contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "supplier_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_id_company_id_key" ON "suppliers"("id", "company_id");
CREATE UNIQUE INDEX "suppliers_company_id_code_key" ON "suppliers"("company_id", "code");
CREATE INDEX "suppliers_company_id_status_idx" ON "suppliers"("company_id", "status");
CREATE INDEX "suppliers_company_id_name_idx" ON "suppliers"("company_id", "name");
CREATE INDEX "suppliers_company_id_updated_at_idx" ON "suppliers"("company_id", "updated_at");

CREATE UNIQUE INDEX "supplier_contacts_id_company_id_key" ON "supplier_contacts"("id", "company_id");
CREATE INDEX "supplier_contacts_company_id_supplier_id_idx" ON "supplier_contacts"("company_id", "supplier_id");
CREATE INDEX "supplier_contacts_supplier_id_is_primary_idx" ON "supplier_contacts"("supplier_id", "is_primary");

-- At most one active primary contact per supplier (DB-enforced concurrency).
CREATE UNIQUE INDEX "supplier_contacts_one_primary_active"
  ON "supplier_contacts" ("supplier_id")
  WHERE "is_primary" = true AND "archived_at" IS NULL;

CREATE INDEX "supplier_notes_company_id_supplier_id_created_at_idx"
  ON "supplier_notes"("company_id", "supplier_id", "created_at");

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_contacts"
  ADD CONSTRAINT "supplier_contacts_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_contacts"
  ADD CONSTRAINT "supplier_contacts_supplier_id_company_id_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_notes"
  ADD CONSTRAINT "supplier_notes_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_notes"
  ADD CONSTRAINT "supplier_notes_supplier_id_company_id_fkey"
  FOREIGN KEY ("supplier_id", "company_id") REFERENCES "suppliers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_notes"
  ADD CONSTRAINT "supplier_notes_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
