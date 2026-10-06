# Finance Expenses + Purchase Costs (Phase 4.7)

Expense is **economic cost**, not cash. Payment is cash movement. They meet only via
`ExpensePaymentAllocation`.

Authority: this document + Phase 4.6 money movements. Purchasing commercial costs remain
`PurchaseOrderCost` (Phase 2.8).

---

## Models

| Model | Role |
|---|---|
| `ExpenseCategory` | Company-scoped categories (`RENT`, `COURIER`, …) |
| `Expense` / `ExpenseSequence` | `EXP-######`; DRAFT → APPROVED → CANCELLED |
| `ExpensePaymentAllocation` | Links POSTED Payment → APPROVED Expense; ACTIVE\|REVERSED |
| `PurchaseOrderCost.treatment` | `CAPITALIZABLE \| PERIOD_EXPENSE` (null until set; then immutable) |
| `PurchaseCostAllocationLine` | Cost → PO item / GR item / FIFO layer |
| `PurchaseCostPaymentAllocation` | Soft payment tracking for CAPITALIZABLE (no Expense row) |
| `InventoryCostComponent` | Provenance of capitalized amounts on FIFO layers |

---

## Core invariants

```text
FIN-EXP-001  Expense is economic cost, not cash movement.
FIN-EXP-002  Payment is cash movement, not automatically Expense.
FIN-EXP-003  Approved unpaid Expense creates no AccountMovement by itself.
FIN-EXP-004  Expense paid amount is derived from canonical active allocations.
FIN-EXP-005  Expense outstanding = amount - paid.
FIN-EXP-006  Expense cannot be over-allocated.
FIN-EXP-007  Allocation never creates duplicate AccountMovement.
FIN-EXP-008  Payment reversal must reconcile Expense settlement state.
FIN-EXP-009  Approved financial Expense history cannot be silently rewritten.
FIN-EXP-010  Original Expense currency is preserved.
FIN-EXP-011  Cross-currency Expense settlement requires explicit FX semantics (Phase 4.9).
FIN-EXP-012  Purchase Cost and General Expense must not double-count one economic cost.
FIN-EXP-013  Purchase Cost treatment is explicit.
FIN-EXP-014  Capitalizable cost may affect inventory acquisition value.
FIN-EXP-015  Period Expense does not affect inventory acquisition value.
FIN-EXP-016  Cost allocation never changes stock quantity.
FIN-EXP-017  Fully allocated Purchase Cost must reconcile to original cost amount.
FIN-EXP-018  Allocation rounding must preserve total cost exactly (largest-remainder).
FIN-EXP-019  Inventory acquisition cost must preserve component provenance.
FIN-EXP-020  Foreign-currency cost aggregation requires explicit FX context.
FIN-EXP-021  Historical applied FX context must remain reproducible.
FIN-EXP-022  Purchase Cost counterparty may differ from PO Supplier.
FIN-EXP-023  Purchase Cost payment does not imply duplicate supplier liability.
FIN-EXP-024  Concurrent allocations cannot overpay or duplicate capitalization.
FIN-EXP-025  All financial references are tenant isolated.
FIN-EXP-026  Financial calculations use Decimal-safe arithmetic.
```

---

## Anti double-count (FIN-EXP-012)

| Treatment | Expense row? | FIFO unit cost? |
|---|---|---|
| `CAPITALIZABLE` | **No** | Yes — via warehouse helper + `InventoryCostComponent` |
| `PERIOD_EXPENSE` | **Yes** (`sourceType=PURCHASE_ORDER_COST`) | No |

Never both inflate period expense totals and inventory acquisition for the same cost.

---

## Lifecycle

```text
Expense: DRAFT → APPROVED | CANCELLED
         APPROVED → CANCELLED only when unpaid (no ACTIVE allocations)
paymentStatus: UNPAID | PARTIALLY_PAID | PAID  (derived)
```

Approve alone → **no** `AccountMovement`.
Pay Now / allocate → Payment posts cash OUT; allocation soft-links; recompute paymentStatus.
Payment reverse (same TX) → reverse ACTIVE allocations (FIN-EXP-008).

---

## Purchase cost financialization

1. `POST .../costs/:id/set-treatment` `{ treatment }`
2. `POST .../costs/:id/allocation-preview` `{ method: BY_QUANTITY|BY_VALUE|MANUAL }`
3. `POST .../costs/:id/allocate` — persist lines; CAPITALIZABLE updates layers

Prefer received identity (layers / GR items) when present; PO items allowed for preview before receipt.

Warehouse helper: `inventory-cost-capitalization.ts` — Finance/Purchasing never mutate layer qty.

---

## Currency

Same-currency allocations only in 4.7. Cross-currency → reject with Phase 4.9 message.

---

## Permissions

- `finance.expenses.read` / `finance.expenses.manage`
- Purchase cost treatment/allocate: existing `purchasing.manage`

---

## Out of scope (do not start)

- Phase 4.8 / Chart of Accounts / Journal / Profit Engine
- Auto-create Expense from Payment
- SupplierPayable settlement from purchase costs
- Cross-currency expense settlement (4.9)
