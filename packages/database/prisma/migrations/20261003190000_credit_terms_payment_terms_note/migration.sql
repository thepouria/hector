-- Phase 2.7 Credit Terms + Due Dates
-- paymentTermsNote is descriptive only. dueStatus remains derived (not persisted).
-- FIXED_DATE already exists on payment_term_type; NET_DAYS / ORDER_DATE already on POs.

ALTER TABLE "purchase_orders"
  ADD COLUMN "payment_terms_note" TEXT;
