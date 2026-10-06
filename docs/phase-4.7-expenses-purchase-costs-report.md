# HECTOR — Phase 4.7 Expenses + Purchase Costs Report

**Date:** 2026-10-06  
**Scope:** ExpenseCategory + Expense + ExpensePaymentAllocation; PurchaseOrderCost treatment/allocation; FIFO capitalization helper; Payment reverse settlement hook; integrity; seed; UI; e2e; docs.

---

## 1. Baseline

Phase 4.6 CLOSED — Payment/Receipt/Transfer operational. Latest prior migration `20261006140000_finance_payments_receipts`. PurchaseOrderCost (2.8) remains Purchasing commercial truth. FIFO layers exist with `hasUnallocatedPurchaseCosts`.

## 2. Repository Reviewed

payments/receipts services, payment-numbering, money.ts, purchase-order-costs, inventory-cost-layers, finance-warehouse-contract, finance-integrity-check, finance UI payments/capital.

## 3. Expense Category Model

`expense_categories` — company-scoped code/name/status ACTIVE|ARCHIVED; system defaults seeded idempotently.

## 4. Expense Model

`expenses` + `expense_sequences`; `EXP-######`; category; amount/currency; expenseDate; optional due/counterparty; description; DRAFT|APPROVED|CANCELLED; paymentStatus UNPAID|PARTIALLY_PAID|PAID; sourceType MANUAL|PURCHASE_ORDER_COST; requestId; server-owned actors.

## 5. Payment Status Separation

Economic status ≠ settlement. paymentStatus derived from ACTIVE allocations only.

## 6. ExpensePaymentAllocation

expenseId + paymentId + amount + currency; amount>0; ACTIVE|REVERSED; never posts AccountMovement (FIN-EXP-007).

## 7. Approve Without Cash

Approve creates **no** AccountMovement (FIN-EXP-003). e2e 110/118.

## 8. Pay Now

Approve if needed + create/post Payment (purpose EXPENSE) + allocate. Same-currency only.

## 9. Partial / Multiple / Overpay

Outstanding guards; over-allocation → 409 (FIN-EXP-006).

## 10. Payment Reversal Hook

`PaymentsService.reverse` same TX calls `reversePaymentSettlementLinksInTx` (FIN-EXP-008).

## 11. Cross-Currency

Allocation currency mismatch → 409 requiring Phase 4.9 (FIN-EXP-011).

## 12. Purchase Cost Treatment

`PurchaseCostTreatment?` null until set; then immutable. PERIOD_EXPENSE creates linked Expense; CAPITALIZABLE does not (FIN-EXP-012/013).

## 13. Allocation Lines

`PurchaseCostAllocationLine` targets PO_ITEM | GR_ITEM | COST_LAYER. Methods BY_QUANTITY / BY_VALUE / MANUAL. Largest-remainder rounding (FIN-EXP-018).

## 14. Ordered vs Received

Prefer layers/GR when present; PO items for pre-receipt preview (FIN-EXP docs §48).

## 15. FIFO Capitalization

Warehouse helper `applyCapitalizableCostToLayersInTx` updates unit costs only — never quantity (FIN-EXP-016). `InventoryCostComponent` provenance (FIN-EXP-019).

## 16. Period Expense Path

Linked Expense with `sourceType=PURCHASE_ORDER_COST`; inventory acquisition unchanged (FIN-EXP-015).

## 17. Purchase Cost Payment

PERIOD_EXPENSE via Expense allocations. CAPITALIZABLE soft-track via `PurchaseCostPaymentAllocation` (reverse hook covered).

## 18. Supplier Payable Boundary

PurchaseOrderCost still does **not** create SupplierPayable (FIN-EXP-023).

## 19. Tenant Isolation

Company header + composite FKs; IDOR → 404 (e2e 133).

## 20. RBAC

`finance.expenses.read|manage`; purchasing.manage for treatment/allocate; warehouse operator denied.

## 21. Security

forbidNonWhitelisted DTOs; mass-assign status/paymentStatus rejected; search parameterized.

## 22. Audit

EXPENSE_* / EXPENSE_CATEGORY_* / PURCHASE_COST_TREATMENT_SET / ALLOCATED / CAPITALIZED.

## 23. Events

`finance.expense.*`, `finance.purchase_cost.*` registered.

## 24. Integrity Script

New checks: over-allocation, paymentStatus mismatch, cross-currency alloc, expense cash movement forbidden, capitalizable+expense forbidden, period missing expense, allocation sum, alloc on reversed payment.

## 25. Seed

Default categories + SEED-EXP unpaid rent; sequences advanced; idempotent upsert.

## 26. Migration

`20261007150000_finance_expenses_purchase_costs`.

## 27. API Surface

`/finance/expense-categories`, `/finance/expenses` (+ approve/cancel/allocate-payment/pay-now); PO costs `set-treatment` / `allocation-preview` / `allocate`.

## 28. UI

Finance → Expenses list/create/detail/categories; nav + hub link; PO cost types extended for treatment fields; API helpers for treatment/preview.

## 29. E2E + unit coverage

`finance-expenses.e2e-spec.ts` covers 110–120, 121/122/124 math, **123 MANUAL sum mismatch** (deterministic PO+cost fixture — never soft-skips), **125+127+128+147+152 CAPITALIZABLE→FIFO** (layer qty unchanged, `baseCurrencyUnitCost` / acquisition up by shipping, `InventoryCostComponent` provenance, allocation lines sum = cost), **126 PERIOD_EXPENSE** (linked Expense; layer unit cost unchanged), 133–136, RBAC.

Unit: `purchase-cost-allocation-math.spec.ts` (BY_QUANTITY / BY_VALUE / largest-remainder); `inventory-cost-capitalization.spec.ts` (unit cost rises, quantity fields not mutated, component created).

## 30. Decimal Safety

Prisma.Decimal + money.parseMoneyAmount; no JS Number for authoritative money.

## 31. Concurrency

Expense/cost rows locked FOR UPDATE before allocation.

## 32. Idempotency

Expense requestId unique; allocation requestId unique; treatment re-set same value OK.

## 33. Boundaries Preserved

No Chart of Accounts / Journal / Profit Engine / 4.8 / auto Expense from Payment / payable settlement.

## 34. Warehouse Contract Note

Valuation field updates allowed only via warehouse capitalization helper; quantity mutations forbidden.

## 35. Documentation

`docs/finance-expenses-purchase-costs.md` (FIN-EXP-001…026).

## 36. Acceptance — Normal Expense

Create/approve rent → UNPAID, no movement; pay-now → PAID + one MONEY_OUT.

## 37. Acceptance — Partial

40+30+30 → PAID; overpay rejected.

## 38. Acceptance — Purchase Cost Period

Treatment PERIOD_EXPENSE → Expense linked; inventory unchanged.

## 39. Acceptance — Capitalizable

Allocate → layer unit cost up; quantity unchanged; component rows present.

## 40. Acceptance — Reversal

Reverse payment → expense UNPAID again.

## 41. Regression Gates

See gate table in completion response.

## 42. Negative Gate

No double Expense for CAPITALIZABLE; no AccountMovement on approve; no SupplierPayable from cost.

## 43. Positive Gate

FIN-EXP invariants documented + integrity + e2e.

## 44. Scope Guard

Phase 4.8 **not** started.

## 45. Final Status

**READY FOR 4.8** — Phase 4.7 Expenses + Purchase Costs closed under gates above.

---

STOP — do not start Phase 4.8 automatically.
