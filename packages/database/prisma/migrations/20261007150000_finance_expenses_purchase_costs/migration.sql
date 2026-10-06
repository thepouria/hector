-- Phase 4.7 — Expenses + Purchase Cost financialization
-- Expense ≠ Payment. CAPITALIZABLE updates FIFO unit cost; PERIOD_EXPENSE links Expense.
-- Allocation never posts AccountMovement. PurchaseOrderCost remains Purchasing commercial truth.

CREATE TYPE "expense_category_status" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "expense_status" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');
CREATE TYPE "expense_payment_status" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID');
CREATE TYPE "expense_source_type" AS ENUM ('MANUAL', 'PURCHASE_ORDER_COST');
CREATE TYPE "expense_payment_allocation_status" AS ENUM ('ACTIVE', 'REVERSED');
CREATE TYPE "purchase_cost_treatment" AS ENUM ('CAPITALIZABLE', 'PERIOD_EXPENSE');
CREATE TYPE "purchase_cost_allocation_target_type" AS ENUM (
  'PURCHASE_ORDER_ITEM',
  'GOODS_RECEIPT_ITEM',
  'INVENTORY_COST_LAYER'
);
CREATE TYPE "purchase_cost_payment_allocation_status" AS ENUM ('ACTIVE', 'REVERSED');
CREATE TYPE "inventory_cost_component_source_type" AS ENUM ('PURCHASE_ORDER_COST');

-- ---------------------------------------------------------------------------
-- Expense categories + sequences + expenses
-- ---------------------------------------------------------------------------

CREATE TABLE "expense_categories" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "expense_category_status" NOT NULL DEFAULT 'ACTIVE',
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expense_categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expense_categories_id_company_id_key"
  ON "expense_categories"("id", "company_id");
CREATE UNIQUE INDEX "expense_categories_company_id_code_key"
  ON "expense_categories"("company_id", "code");
CREATE INDEX "expense_categories_company_status_idx"
  ON "expense_categories"("company_id", "status");

ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_categories"
  ADD CONSTRAINT "expense_categories_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expense_sequences" (
    "company_id" UUID NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "expense_sequences_pkey" PRIMARY KEY ("company_id")
);

ALTER TABLE "expense_sequences"
  ADD CONSTRAINT "expense_sequences_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "expenses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "category_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "expense_date" TIMESTAMPTZ(3) NOT NULL,
    "due_date" TIMESTAMPTZ(3),
    "counterparty_type" "finance_counterparty_type",
    "counterparty_id" UUID,
    "counterparty_name" TEXT,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "notes" TEXT,
    "status" "expense_status" NOT NULL DEFAULT 'DRAFT',
    "payment_status" "expense_payment_status" NOT NULL DEFAULT 'UNPAID',
    "source_type" "expense_source_type" NOT NULL DEFAULT 'MANUAL',
    "source_id" UUID,
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expenses_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "expenses_id_company_id_key" ON "expenses"("id", "company_id");
CREATE UNIQUE INDEX "expenses_company_id_number_key" ON "expenses"("company_id", "number");
CREATE UNIQUE INDEX "expenses_company_source_type_source_id_key"
  ON "expenses"("company_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;
CREATE UNIQUE INDEX "expenses_company_request_id_key"
  ON "expenses"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "expenses_company_status_date_idx"
  ON "expenses"("company_id", "status", "expense_date");
CREATE INDEX "expenses_company_payment_status_idx"
  ON "expenses"("company_id", "payment_status");
CREATE INDEX "expenses_company_category_idx"
  ON "expenses"("company_id", "category_id");
CREATE INDEX "expenses_company_currency_date_idx"
  ON "expenses"("company_id", "currency", "expense_date");
CREATE INDEX "expenses_company_request_id_idx"
  ON "expenses"("company_id", "request_id");

ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_category_company_fkey"
  FOREIGN KEY ("category_id", "company_id")
  REFERENCES "expense_categories"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_approved_by_id_fkey"
  FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_cancelled_by_id_fkey"
  FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Expense payment allocations
-- ---------------------------------------------------------------------------

CREATE TABLE "expense_payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "expense_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "expense_payment_allocation_status" NOT NULL DEFAULT 'ACTIVE',
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_payment_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expense_payment_allocations_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "expense_payment_allocations_id_company_id_key"
  ON "expense_payment_allocations"("id", "company_id");
CREATE UNIQUE INDEX "expense_payment_allocations_company_request_id_key"
  ON "expense_payment_allocations"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "expense_payment_allocations_expense_status_idx"
  ON "expense_payment_allocations"("company_id", "expense_id", "status");
CREATE INDEX "expense_payment_allocations_payment_status_idx"
  ON "expense_payment_allocations"("company_id", "payment_id", "status");
CREATE INDEX "expense_payment_allocations_request_id_idx"
  ON "expense_payment_allocations"("company_id", "request_id");

ALTER TABLE "expense_payment_allocations"
  ADD CONSTRAINT "expense_payment_allocations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_payment_allocations"
  ADD CONSTRAINT "expense_payment_allocations_expense_company_fkey"
  FOREIGN KEY ("expense_id", "company_id")
  REFERENCES "expenses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_payment_allocations"
  ADD CONSTRAINT "expense_payment_allocations_payment_company_fkey"
  FOREIGN KEY ("payment_id", "company_id")
  REFERENCES "payments"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_payment_allocations"
  ADD CONSTRAINT "expense_payment_allocations_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "expense_payment_allocations"
  ADD CONSTRAINT "expense_payment_allocations_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Extend purchase_order_costs
-- ---------------------------------------------------------------------------

ALTER TABLE "purchase_order_costs"
  ADD COLUMN "treatment" "purchase_cost_treatment",
  ADD COLUMN "treatment_set_at" TIMESTAMPTZ(3),
  ADD COLUMN "treatment_set_by_id" UUID,
  ADD COLUMN "expense_id" UUID,
  ADD COLUMN "financialized_at" TIMESTAMPTZ(3),
  ADD COLUMN "allocated_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "purchase_order_costs_company_expense_id_key"
  ON "purchase_order_costs"("company_id", "expense_id")
  WHERE "expense_id" IS NOT NULL;
CREATE INDEX "purchase_order_costs_company_treatment_idx"
  ON "purchase_order_costs"("company_id", "treatment");

ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_treatment_set_by_id_fkey"
  FOREIGN KEY ("treatment_set_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_order_costs"
  ADD CONSTRAINT "purchase_order_costs_expense_company_fkey"
  FOREIGN KEY ("expense_id", "company_id")
  REFERENCES "expenses"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Purchase cost allocation lines
-- ---------------------------------------------------------------------------

CREATE TABLE "purchase_cost_allocation_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "purchase_order_cost_id" UUID NOT NULL,
    "target_type" "purchase_cost_allocation_target_type" NOT NULL,
    "target_id" UUID NOT NULL,
    "allocated_amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_cost_allocation_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_cost_allocation_lines_amount_positive" CHECK ("allocated_amount" > 0)
);

CREATE UNIQUE INDEX "purchase_cost_allocation_lines_id_company_id_key"
  ON "purchase_cost_allocation_lines"("id", "company_id");
CREATE UNIQUE INDEX "purchase_cost_allocation_lines_target_key"
  ON "purchase_cost_allocation_lines"("company_id", "purchase_order_cost_id", "target_type", "target_id");
CREATE INDEX "purchase_cost_allocation_lines_cost_idx"
  ON "purchase_cost_allocation_lines"("company_id", "purchase_order_cost_id");
CREATE INDEX "purchase_cost_allocation_lines_target_idx"
  ON "purchase_cost_allocation_lines"("company_id", "target_type", "target_id");

ALTER TABLE "purchase_cost_allocation_lines"
  ADD CONSTRAINT "purchase_cost_allocation_lines_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cost_allocation_lines"
  ADD CONSTRAINT "purchase_cost_allocation_lines_cost_company_fkey"
  FOREIGN KEY ("purchase_order_cost_id", "company_id")
  REFERENCES "purchase_order_costs"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cost_allocation_lines"
  ADD CONSTRAINT "purchase_cost_allocation_lines_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Purchase cost payment allocations (CAPITALIZABLE soft payment tracking)
-- ---------------------------------------------------------------------------

CREATE TABLE "purchase_cost_payment_allocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "purchase_order_cost_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "status" "purchase_cost_payment_allocation_status" NOT NULL DEFAULT 'ACTIVE',
    "request_id" UUID,
    "created_by_id" UUID NOT NULL,
    "reversed_at" TIMESTAMPTZ(3),
    "reversed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_cost_payment_allocations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_cost_payment_allocations_amount_positive" CHECK ("amount" > 0)
);

CREATE UNIQUE INDEX "purchase_cost_payment_allocations_id_company_id_key"
  ON "purchase_cost_payment_allocations"("id", "company_id");
CREATE UNIQUE INDEX "purchase_cost_payment_allocations_company_request_id_key"
  ON "purchase_cost_payment_allocations"("company_id", "request_id")
  WHERE "request_id" IS NOT NULL;
CREATE INDEX "purchase_cost_payment_allocations_cost_status_idx"
  ON "purchase_cost_payment_allocations"("company_id", "purchase_order_cost_id", "status");
CREATE INDEX "purchase_cost_payment_allocations_payment_status_idx"
  ON "purchase_cost_payment_allocations"("company_id", "payment_id", "status");

ALTER TABLE "purchase_cost_payment_allocations"
  ADD CONSTRAINT "purchase_cost_payment_allocations_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cost_payment_allocations"
  ADD CONSTRAINT "purchase_cost_payment_allocations_cost_company_fkey"
  FOREIGN KEY ("purchase_order_cost_id", "company_id")
  REFERENCES "purchase_order_costs"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cost_payment_allocations"
  ADD CONSTRAINT "purchase_cost_payment_allocations_payment_company_fkey"
  FOREIGN KEY ("payment_id", "company_id")
  REFERENCES "payments"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cost_payment_allocations"
  ADD CONSTRAINT "purchase_cost_payment_allocations_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_cost_payment_allocations"
  ADD CONSTRAINT "purchase_cost_payment_allocations_reversed_by_id_fkey"
  FOREIGN KEY ("reversed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Inventory cost components (FIFO provenance)
-- ---------------------------------------------------------------------------

CREATE TABLE "inventory_cost_components" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "layer_id" UUID NOT NULL,
    "source_type" "inventory_cost_component_source_type" NOT NULL,
    "source_id" UUID NOT NULL,
    "cost_type" "purchase_cost_type" NOT NULL,
    "allocated_amount" DECIMAL(24, 6) NOT NULL,
    "currency" "currency_code" NOT NULL,
    "base_amount" DECIMAL(24, 6),
    "applied_fx_rate" DECIMAL(24, 8),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_cost_components_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_cost_components_amount_positive" CHECK ("allocated_amount" > 0)
);

CREATE UNIQUE INDEX "inventory_cost_components_id_company_id_key"
  ON "inventory_cost_components"("id", "company_id");
CREATE UNIQUE INDEX "inventory_cost_components_layer_source_key"
  ON "inventory_cost_components"("company_id", "layer_id", "source_type", "source_id");
CREATE INDEX "inventory_cost_components_source_idx"
  ON "inventory_cost_components"("company_id", "source_type", "source_id");
CREATE INDEX "inventory_cost_components_layer_idx"
  ON "inventory_cost_components"("company_id", "layer_id");

ALTER TABLE "inventory_cost_components"
  ADD CONSTRAINT "inventory_cost_components_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inventory_cost_components"
  ADD CONSTRAINT "inventory_cost_components_layer_company_fkey"
  FOREIGN KEY ("layer_id", "company_id")
  REFERENCES "inventory_cost_layers"("id", "company_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
