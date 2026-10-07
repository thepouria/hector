# HECTOR — Phase 5
# Sales / Channels — Final QA Report

**Date:** 2026-10-06  
**Scope:** Phase 5.4 closure — Sales API polish, Dashboard, Web UI, Audit/Events review, Integrity/Reconciliation, Final QA.  
**STOP:** No Phase 6 (Marketplace APIs / Settlement / Profit / AR cash settlement).

---

## 1. Baseline

Phases 5.1–5.3 delivered channels, customers, orders, reservation, fulfillment, FIFO, returns, and Finance AR recognition. Phase 5.4 completed operational API/UI/dashboard/integrity without introducing a new business subsystem.

| Gate | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` (API) | 60 suites / **319** tests / Failed 0 / Skipped 0 / Todo 0 |
| `pnpm test` (web) | 18 files / **89** tests / Failed 0 / Skipped 0 / Todo 0 |
| `pnpm test:security` | **32** tests / Failed 0 / Skipped 0 / Todo 0 |
| `sales-*` e2e | 6 suites / **47** tests / Failed 0 / Skipped 0 / Todo 0 |
| `pnpm build` | PASS |
| Integrity (catalog/purchasing/warehouse/finance/sales) | **0** violations each |

---

## 2. Phase 5 Scope Review

| Area | Status |
|---|---|
| Channels / Customers | READY |
| Sales Orders / Wholesale / Lifecycle | READY |
| Reservation / Fulfillment / FIFO | READY |
| Returns | READY |
| Finance AR recognition (not cash settlement) | READY |
| Dashboard + Sales UI | READY |
| Audit / Events | READY |
| Integrity / Reconciliation | READY |
| Marketplace APIs / Settlement / Profit | **DEFERRED** (Phase 6+) |

---

## 3. Sales Architecture

Ownership preserved:

| Domain | Owns |
|---|---|
| Catalog | SKU identity |
| Sales | Customer / Channel / commercial Order truth |
| Warehouse | Physical inventory, reservations, movements, FIFO |
| Finance | Receivable / journal / monetary truth |

Sales does **not** duplicate stock balance, FIFO layers, cash/bank balances, customer debt, journal ledger, or profit.

---

## 4. Channels

PASS — company-scoped codes; types include WEBSITE / marketplace / WHOLESALE / MANUAL / OTHER; activate/deactivate; no API credentials.

## 5. Customer Master

PASS — individual + business; search/filter; addresses; activate/deactivate; no authoritative debt on Customer.

## 6. Sales Orders

PASS — draft create/update; semantic confirm/cancel/partial cancel; server-owned numbers/totals/status; list filters (search/status/channel/customer/paymentTerm/currency/date).

## 7. Wholesale

PASS — WHOLESALE channel + business customer + negotiated prices/discounts + CASH/CREDIT/PARTIAL + due date; same SalesOrder model.

## 8. Commercial Amounts

PASS — server Decimal formulas; integrity recalculation (`money_totals_mismatch: 0`).

## 9. Lifecycle

PASS — DRAFT → CONFIRMED/PROCESSING → PARTIALLY_FULFILLED → FULFILLED; cancel paths; no arbitrary status PATCH.

## 10. Cancellation

PASS — full + partial item cancel; releases/trims reservations; never cancels fulfilled qty.

## 11. Reservations

PASS — Warehouse-backed; SELLABLE only; reduces Available not On Hand; partial OK; release/trim on cancel/fulfill.

## 12. Fulfillment

PASS — DRAFT→COMPLETE posts Warehouse ISSUE; multi-fulfillment; line-scoped reservation consume + leftover release on FULFILLED.

## 13. FIFO Integration

PASS — Warehouse engine owns FIFO; fulfillment traces to ISSUE consumption; Sales does not select layers for users.

## 14. Returns

PASS — create/approve/receive/cancel; returnable = fulfilled − returned; physical receive → RETURN_IN with explicit classification.

## 15. Finance Integration

PASS — fulfillment-scoped CustomerReceivable + journal; no Sales-owned paidAmount/debt; marketplace sale does not auto-increase Bank (`marketplace_sale_auto_cash_movement: 0`).

## 16. API

PASS — channels, customers, orders (+ reserve/release/confirm/cancel), fulfillments, returns, dashboard, finance summary read models. See `docs/sales-api.md`.

## 17. UI

PASS — `/app/sales` dashboard, orders (list/create/detail), customers, channels, returns; reuses Hector layout/tables/forms/dialogs/permissions/RTL patterns.

## 18. Dashboard

PASS — `GET /sales/dashboard` with today|7d|30d|custom + optional channel; aggregates server-side; snapshot/period/by-channel/recent + labeled OPEN receivables from Finance.

## 19. Search / Filters

PASS — parameterized list search; bounded pagination; sort whitelist where exposed.

## 20. RBAC

PASS — backend `RequirePermissions` for channels/customers/orders/reserve/fulfill/returns/dashboard; UI hides unavailable actions. Frontend is not security.

## 21. Tenant Isolation

PASS — company-scoped queries; cross-company IDOR returns 404 in sales e2e; query keys include `companyId`.

## 22. Audit

PASS — material channel/customer/order/reservation/fulfillment/return mutations record structured audit (who/what/when/company/entity + before/after where applicable).

## 23. Domain Events

PASS — committed Sales events for create/confirm/cancel/reserve/release/fulfill/return/finance recognition; no duplicate emit from controller+service; failed TX → no success event.

## 24. Idempotency

PASS — fulfillment complete / recognition / reserve paths reuse existing idempotency patterns; e2e retries do not double ISSUE/AR.

## 25. Concurrency

PASS — concurrent reserve race (total reserved ≤ available); fulfillment/cancel/return invariants covered in execution e2e + integrity.

## 26. Sales Integrity

PASS — `pnpm db:check:sales` / `pnpm sales:integrity` (read-only).

After full `sales-*` e2e (47 tests): **Violations: 0**.

## 27. Sales ↔ Warehouse Reconciliation

PASS — completed fulfillment ↔ ISSUE; received return ↔ RETURN_IN; orphan ACTIVE reservation checks; reservation ≤ open remaining.

## 28. Sales ↔ Finance Reconciliation

PASS — COMPLETED fulfillment missing receivable flagged when grandTotal > 0; marketplace auto-cash guard.

## 29. Performance Sanity

PASS (local) — dashboard/list aggregate in backend; no browser full-scan. Not production benchmarks.

## 30. RTL / Browser QA

**NOT TESTED INTERACTIVELY** in this session. Persian labels and RTL layout conventions applied in code.

## 31. Security QA

| Resource | Read | Create | Update | Lifecycle | Tenant | IDOR |
|---|---:|---:|---:|---:|---:|---:|
| Channels | PASS | PASS | PASS | PASS | PASS | PASS |
| Customers | PASS | PASS | PASS | PASS | PASS | PASS |
| Orders | PASS | PASS | PASS | PASS | PASS | PASS |
| Reservations | PASS | — | — | PASS | PASS | PASS |
| Fulfillments | PASS | PASS | — | PASS | PASS | PASS |
| Returns | PASS | PASS | PASS | PASS | PASS | PASS |
| Dashboard | PASS | — | — | — | PASS | PASS |

Evidence: sales e2e + `test:security` (32).

## 32. Clean Bootstrap

Idempotent `pnpm db:seed` ×2 + peer + sales integrity: **0** violations. Full `docker compose down -v` bootstrap was validated earlier in Phase 5.4 work on this environment.

## 33. Automated Tests

| Layer | Suites/Files | Tests | Failed | Skipped | Todo |
|---|---:|---:|---:|---:|---:|
| API unit | 60 | 319 | 0 | 0 | 0 |
| Web unit | 18 | 89 | 0 | 0 | 0 |
| Security e2e | 1 | 32 | 0 | 0 | 0 |
| Sales e2e | 6 | 47 | 0 | 0 | 0 |

## 34. Build

PASS — monorepo `pnpm build`.

## 35. Documentation

- `docs/sales-architecture.md`
- `docs/sales-invariants.md` (incl. SALE-078…080)
- `docs/sales-api.md`
- this report

## 36. Bugs Found

| Severity | Issue | Fix | Status |
|---|---|---|---|
| HIGH | `sales-returns` e2e seeded `fulfilledQuantity` after confirm without releasing Warehouse reservations → integrity orphans after full sales e2e | Call `POST …/reservations/release` after commercial seed | **FIXED** |
| LOW | Order list filters needed for UI (paymentTerm/date) | Extended list DTO/service | FIXED |
| — | Architecture doc listed AR settlement under 5.4 | Clarified as Phase 6 | FIXED |

## 37. Known Limitations

- Sales channels manually managed
- Marketplace orders manually entered
- No external marketplace API sync
- No marketplace settlement reconciliation
- No Profit Engine / COGS / margin
- No Buy Box automation
- Fulfill UI uses shared location/batch for selected lines (practical)
- Browser RTL / company-switch: **NOT TESTED INTERACTIVELY**

## 38. Technical Debt

- Item cancel qty entry UX is minimal
- Customer `/customers/new` redirects into list dialog pattern
- Interactive browser QA checklist still recommended before production UI sign-off

## 39. Open Issues

None blocking Phase 5 closure.

## 40. Phase 5 Completion Gate

```text
Can we define Sales Channels? YES
Can we define Wholesale as a Channel? YES
Can we define Individual Customers? YES
Can we define Business/Wholesale Customers? YES
Can we create Sales Orders? YES
Can Orders contain multiple SKUs? YES
Can we record negotiated Wholesale prices? YES
Can we record discounts? YES
Can we use CASH terms? YES
Can we use CREDIT terms? YES
Can we use PARTIAL terms? YES
Can we record Due Dates? YES
Can we confirm Orders? YES
Can we partially cancel Orders? YES
Can we fully cancel Orders? YES
Can Orders reserve stock? YES
Does reservation reduce On Hand? NO
Does reservation reduce Available? YES
Can normal Sales use Tester stock? NO
Can normal Sales use Damaged stock? NO
Can Orders be partially fulfilled? YES
Can Orders have multiple fulfillments? YES
Does fulfillment use Warehouse ISSUE? YES
Does fulfillment consume FIFO? YES
Can fulfillment exceed eligible quantity? NO
Can concurrent Orders oversell reserved stock? NO
Can Sales Returns be created? YES
Can Returns be partially received? YES
Does approved Return immediately increase stock? NO
Does physical Return create RETURN_IN? YES
Can returned stock be classified SELLABLE/DAMAGED/QUARANTINE? YES
Can Return exceed fulfilled quantity? NO
Can Wholesale CREDIT create Finance receivable? YES
Does Sales store authoritative Customer debt? NO
Does Sales store authoritative bank balance? NO
Does CASH Order imply actual payment occurred? NO
Does marketplace Sale imply settlement? NO
Does marketplace Sale automatically increase Bank? NO
Can Sales financial effects be traced into Finance? YES
Can Sales physical effects be traced into Warehouse? YES
Can Warehouse movements be traced back to Sales? YES
Can FIFO consumption be traced back to Fulfillment? YES
Can we reconcile Sales ↔ Warehouse? YES
Can we reconcile Sales ↔ Finance? YES
Can we audit material Sales changes? YES
Is Company isolation proven? YES
Are critical operations concurrency-safe? YES
Are critical operations idempotent? YES
Does clean bootstrap pass? YES
Do all automated tests pass? YES
```

### Source-of-Truth Gate

| Question | Expected | Actual |
|---|---|---|
| Catalog owns SKU identity? | YES | YES |
| Sales owns commercial Order truth? | YES | YES |
| Warehouse owns physical stock truth? | YES | YES |
| Finance owns monetary truth? | YES | YES |
| Sales duplicates Product Master? | NO | NO |
| Sales directly overwrites stock? | NO | NO |
| Sales owns Customer debt balance? | NO | NO |
| Sales calculates authoritative Profit? | NO | NO |
| Warehouse execution is traceable to Sales? | YES | YES |
| Finance execution is traceable to Sales? | YES | YES |

### Readiness for Phase 6 / 7

Phase 5 leaves channel, external order id, fulfillment, return, and channel receivable/clearing foundations for future settlement (Phase 6) and FIFO acquisition cost traces for future profit (Phase 7). **Not implemented now.**

---

## PHASE 5 STATUS: COMPLETE

```text
SALES CHANNELS: READY
CUSTOMER MASTER: READY
SALES ORDERS: READY
WHOLESALE: READY
RESERVATIONS: READY
FULFILLMENT: READY
FIFO INTEGRATION: READY
SALES RETURNS: READY
SALES ↔ WAREHOUSE: READY
SALES ↔ FINANCE: READY
SALES API: READY
SALES UI: READY
SALES DASHBOARD: READY
AUDIT / EVENTS: READY
INTEGRITY / RECONCILIATION: READY

READY FOR PHASE 6
```

**STOP — do not begin Phase 6 automatically.**
