-- Phase 6.2 follow-up: composite unique (allocation_id, company_id) was already
-- applied in 20261016180000_settlement_payables_loans_fx. This migration is
-- retained as a no-op so deploy history stays contiguous for databases that
-- may have partially applied an earlier draft of this file.
SELECT 1;
