-- CreateEnum
CREATE TYPE "bulk_operation_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "bulk_operations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "type" TEXT NOT NULL,
    "status" "bulk_operation_status" NOT NULL,
    "selection_mode" TEXT NOT NULL,
    "selection_summary" JSONB,
    "payload_summary" JSONB,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "success_count" INTEGER NOT NULL DEFAULT 0,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "result_summary" JSONB,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "bulk_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bulk_operations_company_id_created_at_idx" ON "bulk_operations"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "bulk_operations_company_id_status_created_at_idx" ON "bulk_operations"("company_id", "status", "created_at");

-- AddForeignKey
ALTER TABLE "bulk_operations" ADD CONSTRAINT "bulk_operations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
