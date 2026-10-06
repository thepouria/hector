-- DropIndex
DROP INDEX "audit_logs_actor_user_id_idx";

-- DropIndex
DROP INDEX "audit_logs_company_id_entity_type_entity_id_idx";

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "actor_company_member_id" UUID,
ADD COLUMN     "request_id" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_company_id_entity_type_entity_id_created_at_idx" ON "audit_logs"("company_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_company_id_actor_user_id_created_at_idx" ON "audit_logs"("company_id", "actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_request_id_idx" ON "audit_logs"("request_id");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_company_member_id_fkey" FOREIGN KEY ("actor_company_member_id") REFERENCES "company_members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
