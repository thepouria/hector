# HECTOR — Phase 4.8 Financial Ledger + Journal Foundation Report

**Date:** 2026-10-06  
**Scope:** LedgerAccount CoA, JournalEntry/JournalLine, posting/reverse, builders wired to capital/loans/transfers/payments/receipts/expenses/purchase costs/GRN AP, integrity, seed, UI, e2e, docs.  
**Gap closed:** `createFromPurchaseOrderCostInTx` now posts `EXPENSE_RECOGNITION` in the same TX (FIN-JRN-019).

---

## 1. Baseline

Phase 4.7 CLOSED. Latest prior migration `20261007150000_finance_expenses_purchase_costs`. No JournalEntry/LedgerAccount before this phase. Permissions `finance.journals.read|post` already existed.

## 2. Repository Reviewed

Finance services (accounts, capital, loans, transfers, payments, receipts, expenses, supplier-payables), purchase-order-cost-finance, domain-events registry, finance-integrity-check, seed, finance UI hub.

## 3. Truth Boundaries

Operational ≠ AccountMovement ≠ Journal. Locked in docs and builders.

## 4. LedgerAccount Model

companyId, code, name, type ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE, systemKey (partial unique), kind SYSTEM|USER_DEFINED, status ACTIVE|ARCHIVED, parentId, description.

## 5. FinancialAccount.ledgerAccountId

Optional FK; backfilled on seed/ensure CoA; lazy-mapped under CASH_AND_BANK.

## 6. ExpenseCategory.ledgerAccountId

Optional FK; mapped under OPERATING_EXPENSE.

## 7. JournalEntry Model

JRN-######; DRAFT|POSTED|REVERSED|CANCELLED; sourceType/sourceId/effectType; baseCurrency; totalDebitBase/totalCreditBase; reversalOfId; requestId; actors; posted/reversed timestamps.

## 8. JournalLine Model

DEBIT|CREDIT; originalAmount/currency; baseAmount/currency; fxRate/fxRateSource; amount > 0 CHECK; company consistency FKs.

## 9. JournalEntrySequence

Company-scoped allocator for JRN numbers.

## 10. Migration

`20261008160000_finance_journal_ledger`.

## 11. Numbering

`journal-numbering.ts` — `formatJournalNumber` / `allocateJournalSequence`.

## 12. Balance Validation

`journal-balance.ts` — Decimal exact; ≥2 lines; non-zero; unbalanced → 400.

## 13. Posting Service

`journal-posting.service.ts` — postInTx, reverseInTx, list/get/manual/post/reverse, ledger lines, trial balance.

## 14. Ledger Accounts Service

list/get/create/archive; resolveSystemKey; resolveFinancialAccountLedger; ensureCompanyChartOfAccounts.

## 15. Journal Builders

Capital, Loan disburse/repay, Transfer, Payment clearing, Receipt clearing, Expense recognition/settlement, Purchase cost capitalize, Supplier AP recognition.

## 16. Capital Wire

Post → DR Bank · CR CAPITAL_EQUITY; reverse reverses journal.

## 17. Loan Wire

Disburse → LOAN_PAYABLE; repay principal → DR LOAN_PAYABLE · CR Bank; never Equity/Expense.

## 18. Transfer Wire

DR Dest · CR Source CoA.

## 19. Payment Wire

Always UNCLASSIFIED_PAYMENTS clearing; no AP settle; no Expense guess.

## 20. Receipt Wire

UNCLASSIFIED_RECEIPTS; never Revenue.

## 21. Expense Wire

Approve / create-with-approveImmediately / PERIOD_EXPENSE `createFromPurchaseOrderCostInTx` → recognition; allocate settlement reclass (no double Expense).

## 22. Purchase Cost Wire

CAPITALIZABLE allocate → capitalize journal; PERIOD_EXPENSE `setTreatment` → linked APPROVED Expense + recognition journal in same TX (no capitalize).

## 23. GRN AP Wire

Same TX as recognizeFromPostedGoodsReceiptInTx; DR INVENTORY · CR SUPPLIER_PAYABLE.

## 24. Manual Journal

create DRAFT + post; reverse; NO AccountMovement.

## 25. APIs

ledger-accounts, journals (+manual/post/reverse), ledger, trial-balance.

## 26. Permissions

journals.read / journals.post (ledger manage reuses post).

## 27. Domain Events

JOURNAL_POSTED / JOURNAL_REVERSED wired into DOMAIN_EVENTS registry.

## 28. Audit

LEDGER_ACCOUNT_*, JOURNAL_CREATED/POSTED/REVERSED.

## 29. Seed CoA

Minimal systemKeys; map FinancialAccounts + ExpenseCategories; idempotent; no historical journal backfill.

## 30. Integrity Script

Unbalanced, <2 lines, zero total, duplicate source effect, duplicate reversal, cross-company, trial balance, capital/loan classification, expense settlement double Expense; header documents Phase 4.8.

## 31. FX Policy

Preserve original + base + rate; no auto FX P&L. FX_GAIN/FX_LOSS keys reserved; FxConversion has no auto journal (out of scope).

## 32. Decimal Safety

Prisma.Decimal only for money paths.

## 33. Tenant Isolation

Composite FKs; IDOR → 404.

## 34. RBAC

Warehouse operator denied journals; owner allowed.

## 35. Posted Immutability

Corrections via reverse only; double reverse idempotent.

## 36. UI

Journals list/detail; Ledger accounts; Trial balance; Persian RTL; hub + nav links.

## 37. Documentation

`docs/finance-ledger-journal.md` (FIN-JRN-001…035 + timing table including PERIOD_EXPENSE same-TX recognition); this report; finance-invariants pointer.

## 38. Unit Tests

`journal-balance.spec.ts` — balance + numbering.

## 39. E2E

`finance-journals.e2e-spec.ts` — balance rejects, capital/loan/transfer, expense no double, payment/receipt clearing, manual no movement, RBAC/IDOR/reverse, USD FX lines, trial balance.  
`finance-expenses.e2e-spec.ts` — PERIOD_EXPENSE → ExpenseRecognition (DR expense · CR EXPENSE_PAYABLE); CAPITALIZABLE allocate → PURCHASE_COST_CAPITALIZE, no expense recognition.

## 40. Constraints Honored

No 4.9 AP settle from Payment; no auto FX P&L; no Profit Engine/COGS; no classification guessing.

## 41. Expense Settlement Pattern

Payment: DR UNCLASSIFIED · CR Bank; Settlement: DR EXPENSE_PAYABLE · CR UNCLASSIFIED (net = preferred accrual cash effect).

## 42. Inventory Timing Decision

AP recognition DR INVENTORY at GRN post to match Phase 4.4 liability timing (documented).

## 43. Positive Gate

Balanced journals post; capital→equity; loan→liability; trial balance ties; PERIOD_EXPENSE recognition posts.

## 44. Negative Gate

Unbalanced/one-line/zero reject; payment≠expense; receipt≠revenue; manual≠cash movement; CAPITALIZABLE≠expense recognition.

## 45. Regression Gates

`pnpm db:generate` · `pnpm typecheck` · `pnpm lint` · `pnpm test` · finance-journals e2e · finance-expenses e2e · `pnpm --filter api test:security` · `pnpm db:check:finance` · `pnpm build`.

## 46. Seed Twice

Idempotent CoA + mappings.

## 47. Out of Scope

4.9 payable settlement from Payment; profit engine; COGS; auto FX gain/loss; historical journal backfill.

## 48. Acceptance Summary

Foundation ready: CoA + journals + builders + APIs + integrity + UI + docs. PERIOD_EXPENSE recognition gap closed (FIN-JRN-019).

## 49. Status

**READY FOR 4.9**
