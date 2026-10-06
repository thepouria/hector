# HECTOR — Phase 4.10 Finance API + UI Report

**Date:** 2026-10-06  
**Scope:** API consolidation + UI/navigation coherence over Phases 4.1–4.9.  
**STOP:** Phase 4.11 (Finance Dashboard + Audit + Events) not started.

---

## 1. Baseline

Phases 4.1–4.9 closed. Domains already implemented: FinancialAccount / AccountMovement, Capital / Loans, Supplier Payables, FX, Payments / Receipts / Transfers, Expenses, Journal / Trial Balance, Liability Settlement (FIN-SET). Phase 4.10 consolidates operator-facing API/UI — no new finance domains.

## 2. Repository Reviewed

Inspected finance controllers, Nest services, Prisma models, web feature pages under `apps/web/src/features/finance/*`, nav-config, routes, React Query keys, settlement/payment detail flows, journals + ledger reports. Source of truth is the repository; 4.1–4.9 architecture was not redesigned.

## 3. API Architecture

Stable paths retained (`account-transfers`, payments, receipts, payables, settlements, expenses, fx, journals, ledger-accounts, trial-balance). Added `GET /finance/general-ledger` on `FinanceLedgerReportsController` → `JournalPostingService.generalLedger`. Controllers remain thin.

## 4. Money Serialization

Money remains Decimal-safe strings with explicit currency on API DTOs. UI uses existing money formatters; no float authoritative math. Large IRR values preserved as Decimal strings.

## 5. Accounts API

Existing accounts CRUD + archive + movements list reused. Balance is server-derived from AccountMovement — never recomputed from a page of movements in the UI.

## 6. Accounts UI

`/app/finance/accounts` + detail with current balance and movement history. Linked from Overview and sidebar «حساب‌ها».

## 7. Payments API/UI

Phase 4.6 APIs + list/create/detail/reverse UI under Money Movements hub. Settle liabilities from payment detail (4.9) retained with reverse allocation control.

## 8. Receipts API/UI

Equivalent list/create/detail under Money Movements. Receipt is not labeled Revenue.

## 9. Transfers API/UI

Account transfers under Money Movements (`/app/finance/account-transfers`). Same-currency and existing cross-currency FX context from 4.5/4.6.

## 10. Capital / Funding API/UI

Capital contributions under «سرمایه و تأمین مالی». Copy explicitly separates equity capital from loans.

## 11. Loans API/UI

Loans listed under Liabilities hub (not Capital). IRR and FX loans show principal / outstanding / liability type.

## 12. Supplier Payables API/UI

Payables list + detail under Liabilities. Outstanding, settled, due date, PO references server-derived.

## 13. Liability Settlement UI

Payable detail: select payment → amount → FX rate when currencies differ → **preview** → confirm → history with reverse. Payment detail settle workflow kept.

## 14. Partial Settlement

Preview shows outstanding before/after; execution via canonical settlement service; multiple settlements supported by 4.9 backend.

## 15. Cross-Currency Settlement

UI surfaces liability currency, payment currency, settlement rate, and preview FX difference lines. Rate not hidden.

## 16. Expenses API/UI

Expenses list/create/detail/approve/pay. `?paymentStatus=UNPAID` for unpaid liabilities view. Derived paid/outstanding not accepted from client.

## 17. Purchase Cost Finance Integration

No duplicate Purchase Cost system. Cost treatment remains Purchasing-linked; finance views costs via existing expense/journal provenance.

## 18. FX API/UI

Rates / conversions / positions under `/app/finance/fx`. Historical rates visible; editing rates does not rewrite historical snapshots.

## 19. Journal API/UI

Journals list/detail under Accounting hub. POSTED journals: Reverse only (no Edit/Delete). Source links where available.

## 20. General Ledger

`GET /finance/general-ledger` + `/app/finance/general-ledger` UI. Requires `ledgerAccountId`; server running balance in company base currency; date filters + pagination.

## 21. Trial Balance

Existing `GET /finance/trial-balance` + UI under Accounting. Debit/Credit totals and difference (expect 0).

## 22. Navigation

Finance sidebar: Overview · Accounts · Money Movements · Liabilities · Expenses · Capital & Funding · FX · Accounting. Hubs at `/money-movements`, `/liabilities`, `/accounting`, `/settlements`.

## 23. Money / Currency UX

Existing MoneyDisplay / MoneyInput patterns; currency codes visible; IRR ↔ toman never silently converted.

## 24. RTL

Persian RTL labels on hubs, overview, GL, settle UX. Numbers remain LTR/tabular where existing components do.

## 25. Responsive / Keyboard UX

Desktop-first tables; existing form Tab/Escape patterns. Destructive actions require explicit click + confirm, not Enter-from-arbitrary-field.

## 26. Company Switching

All finance query keys include `companyId`. Detail routes refetch/reject when active company changes — no stale Company A data on Company B.

## 27. Query Keys / Cache Safety

`financeAccountKeys`, `financePaymentKeys`, `financeJournalKeys.generalLedger`, `financeSettlementKeys`, etc. all company-scoped. Mutations invalidate then refetch (no optimistic balance writes).

## 28. RBAC

Existing `finance.*` permissions reused. UI hides/disables actions; backend remains authoritative.

## 29. Tenant Isolation / IDOR

Company from auth context. E2E covers cross-company journal/GL/trial-balance isolation (404). Detail endpoints company-scoped.

## 30. Mass Assignment

Mutation DTOs exclude server-owned fields (balances, paid/outstanding, journal totals, companyId). Controllers do not accept client-derived financial truth.

## 31. Idempotency

Critical writes continue to use requestId / idempotency from 4.6–4.9. In-flight buttons disable on settle/pay/reverse.

## 32. Concurrency

Settlement service rejects over-settlement / stale outstanding. Concurrent settlement coverage remains in finance-settlements e2e.

## 33. Error Handling

API error codes mapped to Persian UI messages (insufficient balance, over-settlement, archived account, FX context, etc.). No stack traces in UI.

## 34. Source Navigation

Journal ↔ Payment / Expense / Settlement / Payable links where sourceType/sourceId present. PO links from payables.

## 35. Browser QA

**BROWSER QA: NOT TESTED** — no live Playwright/browser walkthrough executed in this change set. Do **not** mark PASS.

## 36. API Tests

`finance-api-ui.e2e-spec.ts`: GL requires ledgerAccountId, running balance, trial-balance scope, journal IDOR. Existing settlements/journals e2e retained.

## 37. UI Tests

Web unit suite includes finance formatting/helpers where present (89 web tests in gate). Hub pages are thin Link shells.

## 38. Security Tests

`NODE_ENV=test pnpm --filter api test:security` — PASS (32).

## 39. Performance

GL/list endpoints use filtered queries + pagination; no intentional N+1 introduced. Bounded page sizes via existing DTOs.

## 40. Integrity

`pnpm db:check:finance` — PASS (0 violations). UI/API work did not weaken FIN-* invariants.

## 41. Regression

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS (API 280 + web 89) |
| security e2e | PASS (32) |
| finance-settlements / journals / api-ui e2e | PASS |
| `pnpm db:check:finance` | PASS |
| `pnpm build` | PASS |
| Browser QA | **NOT TESTED** |

## 42. Clean Bootstrap

Not re-run full `docker compose down -v` in this pass; integrity + e2e against existing DB. Seed unchanged (idempotent seeds from prior phases reused).

## 43. Known Limitations

- Full Finance Dashboard / analytics deferred to **4.11**
- Broad Audit/Event UX deferred to **4.11**
- Browser interactive QA not executed
- Settlements hub is guidance (settle from payment/payable detail), not a global settlement document browser

## 44. Technical Debt

- Optional: richer settlements list read-model if operators need cross-payment settlement browsing
- Browser e2e for company-switch + RTL walkthrough should land with 4.11 or dedicated QA
- FIN-UI docs now match canonical FIN-UI-001…024 from phase brief

## 45. Readiness for 4.11

**PHASE 4.10 STATUS: READY FOR 4.11**

Core Finance API/UI coherent; money precision preserved; settlement + GL + trial balance visible; Capital ≠ Loan; company-scoped keys; RBAC/security/idempotency gates green. **BROWSER QA: NOT TESTED** (explicit). Do not start Profit Engine or Sales finance.
