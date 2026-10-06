-- Phase 3.12 follow-up: legacy 5-column balance unique prevented multiple classifications.
DROP INDEX IF EXISTS "inventory_balances_position_key";
