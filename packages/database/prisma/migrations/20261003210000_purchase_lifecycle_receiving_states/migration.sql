-- Phase 2.9 Purchase Lifecycle
-- Add reserved receiving statuses for Phase 3 Goods Receipt compatibility.
-- No public Purchasing endpoint transitions into PARTIALLY_RECEIVED / RECEIVED.
-- Optional supplierOrderReference for ORDERED commercial tracking.

ALTER TYPE "purchase_order_status" ADD VALUE 'PARTIALLY_RECEIVED';
ALTER TYPE "purchase_order_status" ADD VALUE 'RECEIVED';

ALTER TABLE "purchase_orders"
  ADD COLUMN "supplier_order_reference" TEXT;
