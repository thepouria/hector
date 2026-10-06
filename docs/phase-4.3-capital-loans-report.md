# HECTOR — Phase 4.3 Capital + Funding + Loans Report

**Date:** 2026-10-05  
**Scope:** Capital contributions, loans, disbursements, repayments, integrity, seed, minimal UI.

---

## 1. Baseline

Phase 4.2 CLOSED — FinancialAccount ledger + same-currency transfers operational.

## 2. Repository Reviewed

Accounts balance helpers, transfer posting, FINANCE_* permissions, seed accounts, e2e patterns.

## 3. Schema Changes

Migration `20261005110000_finance_capital_loans`: CapitalContribution, Loan, LoanDisbursement, LoanRepayment + sequences. Partial unique requestId. CHECK amount > 0.

## 4. Funding Model

Explicit CapitalFundingType (OWNER_EQUITY, PARTNER_EQUITY, OTHER_FUNDING). LOAN is a separate entity.

## 5. Capital Contribution

CAP-######; DRAFT→POSTED/CANCELLED; POSTED→REVERSED. Snapshot contributorName required.

## 6. Funding Types

OTHER_FUNDING requires notes. Never inferred from counterparty identity.

## 7. Contributor / Counterparty

FinanceCounterpartyType lightweight enum; no Person master duplication.

## 8. Capital Posting

Atomic POST + MONEY_IN via AccountMovementsWriter; sourceType=CAPITAL_INJECTION.

## 9. Capital Reconciliation

Summary by currency only — no FX sum.

## 10. Loan Model

LOAN-######; contractedPrincipal ceiling; receivingAccountId optional default.

## 11. Loan Currency

One contractual currency; never revalued to IRR in place.

## 12. Original Principal

contractedPrincipal retained; received derived from posted disbursements.

## 13. Loan Disbursement

Multiple allowed; sum ≤ contractedPrincipal; MONEY_IN LOAN_DISBURSEMENT.

## 14. Multiple Disbursement Support

Yes — sequential LDS documents under one Loan.

## 15. Loan Repayment

LRP-######; cash OUT = principal+interest+fee.

## 16. Principal vs Interest / Fees

Only principalAmount reduces outstanding; interest/fee foundation only.

## 17. Outstanding Principal

Derived always; never editable field.

## 18. Loan Lifecycle

DRAFT / ACTIVE / PARTIALLY_REPAID / SETTLED / CANCELLED / REVERSED.

## 19. Due Dates / Overdue

Optional dueDate; overdue = dueDate < now AND outstanding > 0.

## 20. FX Boundary

Reference FX rate optional; settlement deferred to 4.5/4.9; schema does not block.

## 21. Account Integration

AccountMovementsWriter locks accounts, validates ACTIVE + currency, balance guards on OUT.

## 22. Atomicity

Document + movement in one transaction.

## 23. Idempotency

requestId on documents; conflict on payload mismatch.

## 24. Concurrency

FOR UPDATE on loan + accounts; concurrent over-repay rejected.

## 25. Immutability / Reversal

Posted history immutable; reverse via corrective docs.

## 26. Tenant Isolation

Company-scoped queries; IDOR returns 404.

## 27. RBAC

finance.capital.read/manage; finance.loans.read/manage (repay uses manage).

## 28. Security

Warehouse operator denied; cross-tenant IDOR covered in security suite.

## 29. Audit

Capital/loan/disbursement/repayment create/post/cancel/reverse/settled actions.

## 30. Domain Events

finance.capital.injected, finance.loan.created/disbursed/repaid/settled + reversals.

## 31. API

`/finance/capital-contributions`, `/finance/loans`, nested disbursements/repayments.

## 32. UI

Nav سرمایه / وام‌ها; list/new/detail + repay form; Persian labels; no silent FX aggregation.

## 33. Integrity / Reconciliation

finance-integrity-check extended for capital↔IN, disbursement↔IN, repayment↔OUT, over-repay, currency, tenant.

## 34. Database Constraints

FKs Restrict; partial unique requestId; positive amount CHECKs.

## 35. Performance

Indexed company+status+created; loan+status; sequences atomic.

## 36. Migration

`20261005110000_finance_capital_loans` applied via migrate deploy.

## 37. Seed

Pishteh: Ahmad 2B + Pouria 1B PARTNER_EQUITY → Mellat; Ahmad LOAN 500M; External USD 10k → CASH-USD @ 250000.

## 38. Automated Tests

Unit outstanding/funding helpers; e2e finance-capital-loans; security IDOR +1.

## 39. Regression

See completion gate below.

## 40. Clean Bootstrap

Supported via migrate deploy + idempotent seed.

## 41. Known Limitations

No withdrawals/distributions; no cross-currency repay; interest not amortized.

## 42. Technical Debt

Optional further refactor of opening/transfer to AccountMovementsWriter.

## 43. Readiness for 4.4

Ready when regression green — Payables next; Capital/Loans not in Payables scope.

---

## Completion gate

| Gate | Result |
|------|--------|
| Capital vs Revenue separation | PASS |
| Capital vs Debt separation | PASS |
| Partner can contribute Equity | PASS |
| Partner can separately become Lender | PASS |
| IRR Loan / USD Loan | PASS |
| Original Currency / Principal preservation | PASS |
| Partial / Multiple / Full repayment | PASS |
| Overpayment + account balance guard | PASS |
| Atomic cash effects | PASS |
| Idempotency / Concurrency | PASS |
| Tenant isolation / RBAC / Security | PASS |
| Audit / Events | PASS |
| Funding ↔ Account / Loan ↔ Account / Outstanding reconciliation | PASS |
| Regression / Build | PASS |

### Regression results

| Command | Result |
|---------|--------|
| `pnpm db:migrate:deploy` / `db:generate` | PASS |
| `pnpm typecheck` / `lint` / `build` | PASS |
| `pnpm test` | API **251** passed |
| `pnpm test:security` | **30** passed |
| `pnpm test:e2e` | **422** passed |
| `pnpm db:check:finance` | **0 violations** |
| `pnpm db:check:catalog` / `purchasing` | OK |

### Final status

```text
PHASE 4.3 STATUS: READY FOR 4.4
```

STOP — do not start Phase 4.4 (Supplier Payables) automatically.
