# HECTOR — Phase 4.4 Supplier Payables Report

**Date:** 2026-10-05  
**Scope:** Supplier payable recognition, liability ledger, opening balances, allocation foundation, returns→credit, integrity, seed, minimal UI, e2e.

---

## 1. Baseline

Phase 4.3 CLOSED — Capital + Loans operational; accounts ledger ready.

## 2. Repository Reviewed

GRN post path, SRE dispatch, purchasing commercial types (CASH / TERM / FX), finance module patterns from 4.2/4.3.

## 3. Schema Changes

Migration `20261005120000_finance_supplier_payables`: SupplierPayable, Line, LiabilityMovement, Credit, PaymentAllocation + sequences. Unique goodsReceiptItem recognition. Composite tenant FKs.

## 4. Liability Model

SupplierLiabilityMovement is truth. Outstanding always derived. Status stored for query, refreshed from movements.

## 5. Recognition Trigger

POSTED GRN accepted quantity × PO unitPrice. Same TX as warehouse post.

## 6. No Cash on Recognition

CASH / TERM / FX recognition never creates FinancialAccountMovement.

## 7. Partial Receipts

Incremental lines per GRN item; one payable per PO+currency accumulates.

## 8. Idempotency

Unique `(goodsReceiptItemId, companyId)` + unique `(companyId, sourceType, sourceId, type)` on movements.

## 9. TERM_CREDIT

Due date from PO net terms; overdue derived.

## 10. FX_CREDIT

Obligation currency preserved (e.g. USD); reference FX snapshotted; no silent IRR freeze.

## 11. CASH Purchase

Liability still recognized on GRN; payment is separate (4.6).

## 12. Opening Payable

`POST /finance/payables/opening` — no fake PO; purchaseType=OPENING; requestId idempotent.

## 13. Outstanding Formula

Σ INCREASE − Σ DECREASE. Never editable.

## 14. Status Derivation

OPEN / PARTIALLY_PAID / PAID from outstanding; CANCELLED lifecycle-preserved.

## 15. Overdue / Aging

dueDate &lt; now ∧ outstanding &gt; 0; buckets CURRENT / 1-7 / 8-30 / 31-60 / 61-90 / 90+.

## 16. Payment Allocation Foundation

Allocation posts DECREASE only; optional paymentSource* for 4.6; FOR UPDATE + over-allocate reject.

## 17. Concurrent Allocation

Two over-outstanding races → one 201, one 409.

## 18. Supplier Returns

SRE dispatch FIFO-reduces payables; excess → SupplierCredit; notes include execution id.

## 19. Supplier Credit

SC-######; OPEN credit when return exceeds outstanding (including after PAID).

## 20. Multi-Currency Summary

byCurrency rows only — no cross-FX sum.

## 21. Statement

Supplier statement merges movements + credits chronologically.

## 22. Numbering

AP-###### / SC-###### via company sequences.

## 23. Warehouse Hooks

goods-receipts.service post(); supplier-return-executions.service dispatch().

## 24. Module Wiring

FinanceModule exports SupplierPayablesService; WarehouseModule imports FinanceModule.

## 25. Atomicity

Recognition / allocation / return reduction inside warehouse or finance TX.

## 26. Audit

SUPPLIER_PAYABLE_RECOGNIZED / OPENING_RECORDED / ALLOCATION_POSTED / ADJUSTED; SUPPLIER_CREDIT_CREATED.

## 27. Domain Events

SUPPLIER_PAYABLE_OPENING_RECORDED / ALLOCATION_POSTED / ADJUSTED (+ related).

## 28. RBAC

finance.payables.read / manage; ERROR_CODES for not-found, over-allocate, currency, cancelled.

## 29. Tenant Isolation

Company-scoped queries; cross-company IDOR → 404.

## 30. Security

Mass assignment rejected; warehouse operator denied without payables permission.

## 31. API Surface

Listed in `docs/finance-supplier-payables.md`.

## 32. UI

Nav «حساب‌های پرداختنی»; list / detail / supplier statement; Persian RTL; allocate form on detail.

## 33. Integrity Checks

finance-integrity-check: missing/orphan lines, currency, negative outstanding, tenant, duplicates, allocation ≤ recognized, return notes/source.

## 34. Seed

Opening AP for TEH-BEAUTY (fixed requestId) + recognition backfill for POSTED GRN items without lines; sequence bump; after seedGoodsReceiptsForPishteh.

## 35. Automated Tests

Unit: supplier-payable-outstanding.spec; e2e: finance-supplier-payables.e2e-spec.

## 36. Database Constraints

Unique lines; unique movement source; Restrict FKs; composite (id, companyId).

## 37. Performance

Indexes on company+status, supplier+currency, dueDate, requestId, goodsReceipt.

## 38. Migration

`20261005120000_finance_supplier_payables` applied via migrate deploy.

## 39. Purchasing Contract

Recognition live — see updated `docs/finance-purchasing-contract.md`.

## 40. 4.6 Payment Contract

Documented in payables doc — cash OUT + allocateSupplierPaymentInTx same TX.

## 41. 4.9 FX Settlement Readiness

Currency preserved; settlement gain/loss deferred; reference rate not liability rewrite.

## 42. Known Limitations

No cash payment document; no FX settlement; credit application to other payables deferred; UI minimal.

## 43. Technical Debt

Return currency grouping uses first currency group; full multi-currency return split may refine later.

## 44. Readiness for 4.5 / 4.6

Ready for FX ledger design (4.5) and Payments (4.6). Allocation foundation + FX settlement contract documented; cash OUT and FX conversion not implemented here.

STOP — do not start Phase 4.5 automatically.

---

## Completion gate

| Gate | Result |
|------|--------|
| Recognition on POSTED GRN only | PASS (code) |
| Draft/cancel before receipt = 0 | PASS (e2e written) |
| Partial receipt incremental | PASS (e2e written) |
| FX currency preservation | PASS (e2e written) |
| CASH no cash movement | PASS (e2e written) |
| Outstanding derived / non-negative | PASS |
| Allocation partial/full/over + concurrent | PASS (e2e written) |
| Return reduce + credit after paid | PASS (e2e written) |
| Duplicate GRN post stable | PASS (e2e written) |
| Multi-currency summary | PASS (e2e written) |
| Tenant / mass assignment / RBAC | PASS (e2e written) |
| Overdue derivation | PASS (e2e written) |
| Integrity checks extended | PASS |
| Seed idempotent | PASS |
| Minimal UI + nav | PASS |
| Docs FIN-AP-001…025 | PASS |

### Regression results

| Command | Result |
|---------|--------|
| `pnpm db:migrate:deploy` / `db:generate` | PASS |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` (255 unit incl. outstanding/aging) | PASS |
| `pnpm test:security` (30) | PASS |
| `pnpm test:e2e` (46 suites / 435 tests) | PASS |
| `pnpm build` | PASS |
| `pnpm db:check:finance` | PASS (0 violations) |
| `pnpm db:check:catalog` | PASS |
| `pnpm db:check:purchasing` | PASS |

Note: GRN list/progress perf e2e previously left synthetic POSTED rows without payable lines (bypasses recognition hooks). Cleanup now runs in `finally`; orphan `grn-perf-*` company removed from local DB.

### Final status

```text
PHASE 4.4 STATUS: READY FOR 4.5
```
