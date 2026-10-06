# HECTOR — Phase 4.6 Payments + Receipts + Transfers Report

**Date:** 2026-10-06  
**Scope:** Payment + Receipt + Transfer (reuse FinancialAccountTransfer), integrity, seed, UI, e2e/security, docs.

---

## 1. Baseline

Phase 4.5 CLOSED — FX rates/conversions/positions operational; accounts + capital/loans + payables ready.

## 2. Repository Reviewed

`postMovementsInTx`, AccountTransfers, CapitalContribution, LoanDisbursement/Repayment, FxConversion, SupplierPayable allocation foundation, finance UI patterns (capital/fx/accounts).

## 3. Money Movement Architecture

Explicit documents: `Payment` (money-out), `Receipt` (money-in), `FinancialAccountTransfer` (internal same-currency). Canonical balance = SUM(AccountMovement). No generic Transaction dump table.

## 4. Source-of-Truth Boundaries

Financial document → AccountMovement → derived balance. Documented matrix in `docs/finance-money-movements.md`. Capital/Loan/FX keep specialized cash posting (no Payment/Receipt wrap).

## 5. Payment Model

`payments` + `payment_sequences`; PAY-######; purposeType; optional counterparty/purposeReference/reference; requestId; DRAFT|POSTED|CANCELLED|REVERSED; reversalOf.

## 6. Receipt Model

`receipts` + `receipt_sequences`; REC-######; sourceType; mirrors Payment lifecycle.

## 7. Transfer Model

Reuse `FinancialAccountTransfer` (FAT-######) at `/finance/account-transfers`. No second Transfer model; no `/finance/transfers` alias (documented reuse).

## 8. AccountMovement Integration

Payment → MONEY_OUT `sourceType=PAYMENT`. Receipt → MONEY_IN `sourceType=RECEIPT`. Transfer → TRANSFER_OUT + TRANSFER_IN `sourceType=ACCOUNT_TRANSFER`.

## 9. Currency Rules

Payment/Receipt currency copied from account. Transfer requires same currency. Cross-currency → FX Conversion (4.5).

## 10. FX Boundary

IRR↔USD not faked as Transfer. Wrong-currency payment claim ignored/rejected; account currency wins.

## 11. Counterparty

Optional FinanceCounterpartyType + id/name on Payment/Receipt.

## 12. Purpose / Source

PaymentPurposeType (incl. SUPPLIER, EXPENSE labels). ReceiptSourceType (incl. CAPITAL/LOAN labels only — not Capital/Loan cash docs).

## 13. Lifecycle

DRAFT → POSTED | CANCELLED; POSTED → REVERSED. Posted immutable.

## 14. Posting

Atomic TX: lock row + account(s) + balance check + movement(s) + status. Idempotent re-post returns existing POSTED.

## 15. Cancellation

DRAFT only; no movements. Posted cancel → reject.

## 16. Reversal

Creates reversal document + opposite REVERSAL movement; original history preserved; reason required (Payment/Receipt).

## 17. Balance Guards

Insufficient balance → 409, no movements. Transfer reverse checks destination funds.

## 18. Atomicity

Transfer OUT+IN in one TX. Payment/Receipt single movement in one TX with status flip.

## 19. Idempotency

Unique `(companyId, requestId)` where set; retry returns same row; material mismatch → conflict.

## 20. Concurrency

Account FOR UPDATE + balance check; concurrent posts on limited balance → at most one success (e2e).

## 21. Capital Integration

CapitalContribution continues CAPITAL_INJECTION posting directly — not wrapped as Receipt (FIN-MOV-024).

## 22. Loan Integration

Disbursement/repayment continue LOAN_* movements — not wrapped as Receipt/Payment.

## 23. Supplier Payable Boundary

`purposeType=SUPPLIER` posts cash only; outstanding unchanged; no SupplierPaymentAllocation until **4.9**. Docs updated accordingly.

## 24. Duplicate Financial Effect Review

Integrity + e2e prove one movement per posted Payment/Receipt; Transfer pair uniqueness; Capital/Loan unchanged.

## 25. Tenant Isolation

Company header scoping; composite FKs; cross-company account refs integrity check; IDOR → 404.

## 26. RBAC

`finance.payments.*`, `finance.receipts.*`, `finance.transfers.*`. Web keys include receipts. Warehouse operator denied.

## 27. Security

forbidNonWhitelisted DTOs; mass-assign companyId/status rejected; search parameterized; security e2e + suite coverage.

## 28. Audit

`PAYMENT_*` / `RECEIPT_*` actions; entity types PAYMENT / RECEIPT; recorded in-TX.

## 29. Events

`finance.payment.*` / `finance.receipt.*` after commit via commitThenPublish.

## 30. API

`/finance/payments`, `/finance/receipts`, `/finance/account-transfers` (list/create/get/patch/post/cancel/reverse).

## 31. UI

Persian RTL: Finance hub + nav — Payments, Receipts, Transfers; list/create/detail; confirm before post; reverse with reason; currency from account.

## 32. Database Constraints

CHECK amount > 0; unique (companyId, number); partial unique requestId; composite tenant FKs; self-FK reversalOf.

## 33. Indexes

status/createdAt, accountId, purpose/source, currency, reversalOfId, requestId.

## 34. Integrity

Extended `finance-integrity-check.ts`: missing movements, duplicates, currency mismatch, same-account transfer, non-positive amounts, reverse provenance, cross-company accounts, SUPPLIER without allocation. Read-only; no auto-repair.

## 35. Reconciliation

Posted docs ↔ AccountMovement counts; balances derived from movements only.

## 36. Performance

Bounded list pagination; sequence allocate via upsert; account locks ordered in writer.

## 37. Migration

`20261006140000_finance_payments_receipts` (already applied in phase start).

## 38. Seed

Idempotent SEED-PAY-DRAFT-001, SEED-PAY-000001 (+ OUT), SEED-REC-000001 (+ IN); requestId keys; sequences ignore SEED-* prefixes. Transfer seed remains 4.2.

## 39. Automated Tests

`apps/api/test/finance-payments-receipts.e2e-spec.ts` + security payments/receipts case; transfer concurrency already in `finance-accounts.e2e-spec.ts`.

## 40. Regression

`pnpm db:generate` → migrate if needed → typecheck → lint → test → test:security → e2e finance-payments-receipts → `db:check:finance` → build. Seed twice when practical.

## 41. Clean Bootstrap

Migrate + generate + seed×2 + integrity expected clean for money-movement fixtures.

## 42. Known Limitations

SUPPLIER payment does not settle AP (4.9). purposeType=EXPENSE does not create Expense (4.7). No bank import/reconciliation. No intercompany transfers.

## 43. Technical Debt

Optional `/finance/transfers` alias skipped (prefer documented reuse). UI is vertical minimal (4.10 consolidates).

## 44. Readiness for 4.7

**PHASE 4.6 STATUS: READY FOR 4.7**

STOP — do not start Phase 4.7 (Expenses) automatically.
