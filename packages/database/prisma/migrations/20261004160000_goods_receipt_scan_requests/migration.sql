-- Phase 3.6: bounded scanner apply idempotency (not inventory truth).
CREATE TABLE "goods_receipt_scan_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "company_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "response_json" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "goods_receipt_scan_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "goods_receipt_scan_requests_company_id_goods_receipt_id_request_id_key"
  ON "goods_receipt_scan_requests"("company_id", "goods_receipt_id", "request_id");

CREATE INDEX "goods_receipt_scan_requests_goods_receipt_id_idx"
  ON "goods_receipt_scan_requests"("goods_receipt_id");

ALTER TABLE "goods_receipt_scan_requests"
  ADD CONSTRAINT "goods_receipt_scan_requests_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "goods_receipt_scan_requests"
  ADD CONSTRAINT "goods_receipt_scan_requests_goods_receipt_id_company_id_fkey"
  FOREIGN KEY ("goods_receipt_id", "company_id") REFERENCES "goods_receipts"("id", "company_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
