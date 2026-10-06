# HECTOR — Phase 4.9 Liability Settlement Report

**Date:** 2026-10-06  
**Scope:** Evolve `SupplierPaymentAllocation` + `SettlementService` facade; AP settle journal + FX; Payment reverse; permissions; integrity; e2e; minimal UI; docs.  
**STOP:** Phase 4.10 not started.

---

## 1. Architecture decision

**Specialized SoT + SettlementService facade (pragmatic path A):**

1. Extend `SupplierPaymentAllocation` with hard `paymentId?`, status `POSTED|REVERSED`, FX columns, `settlementGroupId` — **no** separate `LiabilitySettlement` batch document / SET-###### numbering.
2. Keep `ExpensePaymentAllocation` as expense settle SoT (FIN-SET-006); facade is supplier-AP focused.
3. Keep `LoanRepayment` direct path (FIN-SET-014).
4. Never auto-settle on Payment post (FIN-SET-001).

## 2. Migration

`20261009170000_finance_liability_settlement` after `20261008160000_finance_journal_ledger`.

## 3. Journal

`postSupplierPayableSettlementJournalInTx`:

- Same ccy: DR SUPPLIER_PAYABLE · CR UNCLASSIFIED_PAYMENTS
- Cross-ccy: DR SUPPLIER_PAYABLE (carrying) · DR FX_LOSS | CR FX_GAIN · CR UNCLASSIFIED_PAYMENTS
- sourceType `SUPPLIER_PAYMENT_ALLOCATION`, effectType `SUPPLIER_AP_SETTLEMENT`

## 4. Payment reverse

`PaymentsService.reverse` → `SettlementService.reverseForPaymentInTx` first, then expense links, then payment clearing journal (FIN-SET-010).

## 5. Permissions

`finance.settlements.read` / `finance.settlements.manage`.

## 6. APIs

- `POST /finance/settlements/preview`
- `GET|POST /finance/payments/:paymentId/settlements`
- `POST /finance/payables/:payableId/settle`
- `GET /finance/settlements/:id` · `POST /finance/settlements/:id/reverse`

## 7. Integrity / seed / UI / e2e / docs

- Integrity checks for over-allocate, over-settle, missing journal, second Bank, reverse movement
- Permissions sync via existing seed helpers (idempotent)
- Payment detail settlements panel
- `finance-settlements.e2e-spec.ts`
- `docs/finance-liability-settlement.md` + supplier-payables 4.9 update

## 8. Invariants

FIN-SET-001 … FIN-SET-014 documented in `docs/finance-liability-settlement.md`.

## 9. Gate results

| Gate | Result |
|---|---|
| `pnpm db:generate` | PASS |
| migrate `20261009170000_finance_liability_settlement` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm --filter @hector/api test` | PASS (277) |
| `finance-settlements` e2e | PASS (9) |
| `pnpm --filter api test:security` | PASS (32) |
| `pnpm db:check:finance` | PASS (0 violations) |
| `pnpm build` | PASS |

## 10. STATUS

**READY FOR 4.10** — Phase 4.9 closed; do not start 4.10 in this change set.
