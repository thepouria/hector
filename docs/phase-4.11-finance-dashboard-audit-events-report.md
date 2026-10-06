# HECTOR — Phase 4.11 Finance Dashboard + Audit + Events Report

**Date:** 2026-10-06  
**Scope:** Finance operational dashboard, finance-scoped audit API/UI, domain-event hygiene.  
**STOP:** Phase 4.12 not started. No Sales / Profit / COGS.

---

## 1. Baseline

Phases 4.1–4.10 closed. AuditService + DomainEventBus + `commitThenPublish` already wired. Permissions `finance.dashboard.read` / `finance.audit.read` pre-defined. Overview was hub-only.

## 2. Repository Reviewed

Accounts, movements, capital, loans, payables, FX, payments/receipts/transfers, expenses, journals, settlements, generic Audit + Events, purchasing/warehouse dashboard patterns, 4.10 Finance UI. No redesign of working Finance architecture.

## 3. Dashboard Architecture

`FinanceDashboardService` server-side aggregates. Frontend consumes one read model (`GET /finance/dashboard`). Mirrors Purchasing dashboard date-range pattern.

## 4. Dashboard API

`GET /finance/dashboard` — requires `finance.dashboard.read`. Query: `range`, `from`, `to`, `chartCurrency`. Response: `asOf`, `period`, `snapshot`, `periodMetrics`, `recentActivity`, `semantics`.

## 5. Account / Liquidity Summary

ACTIVE accounts by currency × type (CASH/BANK/WALLET). Balance = SQL `SUM(IN)−SUM(OUT)`. Liquidity labeled as balances — not Net Worth / Profit.

## 6. Multi-Currency Handling

Currencies never summed. Trend is single `chartCurrency`. Top suppliers ranked within each currency group. Decimal-safe strings (large IRR via `::text`).

## 7. Supplier Payables

Outstanding by currency from liability movements. Separate from loans/expenses.

## 8. Loans

Outstanding principal by currency. Shown as Liability — not Capital / Expense / Revenue.

## 9. Due Soon / Overdue

`FINANCE_LIABILITY_DUE_SOON_DAYS = 7`. Overdue: dueDate < today AND outstanding > 0. Fully settled excluded. Bounded lists; navigate to canonical detail.

## 10. Money In

POSTED Receipts in period by currency. Labeled Money In / Receipts — **not Revenue**.

## 11. Money Out

POSTED Payments in period by currency. Labeled Money Out / Payments — **not Expense**.

## 12. Internal Transfer Treatment

Internal AccountTransfers excluded from Money In/Out. Documented in `semantics.internalTransfersExcludedFromMoneyInOut`.

## 13. Expenses

Period expenses recorded + by category from Expense domain only. Outstanding snapshot separate. Not inferred from Payments.

## 14. Charts

Money In vs Money Out trend (day/week) for selected currency. Explicitly not Profit. Reuses purchasing chart primitives.

## 15. Recent Activity

Last 20 finance AuditLog rows. RBAC-gated (`finance.audit.read` or `audit.read`). Links to entities when permitted.

## 16. Dashboard RBAC

Sections omitted (not zero-faked) when member lacks domain read (accounts/payables/loans/expenses/payments/receipts/audit).

## 17. Dashboard Tenant Isolation

All aggregations company-scoped. E2E asserts Company B does not see Company A totals.

## 18. Dashboard Performance

Bounded SQL aggregates + list limits. No fetch-all-then-aggregate-in-JS for cards.

## 19. Audit Architecture

Reuse generic AuditLog. No FinanceAuditLog table. Finance mutations already audited in 4.2–4.10 services.

## 20. Audit Coverage

Accounts, capital, loans, FX, payments, receipts, transfers, expenses, settlements, journals, ledger accounts — material mutations audited.

## 21. Audit API

`GET /finance/audit` + `GET /finance/audit/:id` require `finance.audit.read`. Entity types restricted to finance set; non-finance filter → 400. Read-only.

## 22. Audit UI

`/app/finance/audit` — filters, human-readable action labels, detail dialog, entity navigation. Persian RTL.

## 23. Entity History

`FinanceEntityHistory` on payment / receipt / expense / loan / payable detail pages.

## 24. Audit Security

Immutable via normal APIs. Tenant-scoped. Sanitizer for secrets. Cross-company → 404.

## 25. Domain Event Architecture

Existing DomainEventBus + `commitThenPublish`. In-process only — no Kafka/outbox. Audit ≠ Events.

## 26. Event Catalog

`FINANCE_DOMAIN_EVENT_TYPES` synced with `domain-events.registry.ts` (accounts, transfers, capital, loans, payables/settlements, FX, payments, receipts, expenses, purchase costs, journals).

## 27. Event Payloads

IDs + business facts + currency-explicit Decimal strings. No full DB dumps. No JournalLine storms.

## 28. Event Transaction Semantics

Publish only after successful commit. Failed transactions do not emit success events.

## 29. Event Idempotency

Idempotent domain requests → one economic effect → one canonical event (existing requestId patterns).

## 30. Correlation

requestId / audit correlation where infrastructure supports multi-effect ops (settlement + journal).

## 31. Company Isolation

Dashboard + audit query keys include `companyId`. Detail/history company-safe.

## 32. RTL / Browser QA

UI copy Persian RTL. **BROWSER QA: NOT TESTED** — no live browser walkthrough.

## 33. Unit Tests

`finance-dashboard.metrics.spec.ts` — due-soon constant, range, currency purity helpers. API unit suite 288 PASS.

## 34. E2E Tests

`finance-dashboard.e2e-spec.ts` (5): multi-currency, RBAC strip, audit entity filter, tenant isolation. Settlements smoke retained.

## 35. Security Tests

`test:security` — 32 PASS.

## 36. Performance Sanity

Bounded aggregates; no N+1 card fan-out introduced.

## 37. Integrity

`pnpm db:check:finance` — 0 violations.

## 38. Regression

| Gate | Result |
|---|---|
| typecheck / lint / test | PASS |
| security e2e | PASS (32) |
| finance-dashboard e2e | PASS (5) |
| `db:check:finance` | PASS |
| build | PASS |
| Browser QA | **NOT TESTED** |

## 39. Known Limitations

- In-process events (no durable outbox)
- Browser interactive QA not executed
- Optional base-currency approximate holdings deferred when no valid rate
- Full Profit dashboard belongs to Phase 7 — not here

## 40. Technical Debt

- Browser e2e for company-switch + RTL walkthrough
- Durable outbox when multi-service consumers appear
- Optional Approximate Base Currency card when rate read-model is productized

## 41. Readiness for 4.12

**PHASE 4.11 STATUS: READY FOR 4.12**

0 BLOCKER / 0 HIGH on Dashboard, Audit, Events foundation. **BROWSER QA: NOT TESTED**. Do not start Phase 4.12 / 5 / Profit automatically.
