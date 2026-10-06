# Finance Supplier Payables (Phase 4.4)

Supplier liability ledger. Recognition on POSTED Goods Receipt. Outstanding is always derived. Cash does **not** move on recognition.

## Payables — FIN-AP-*

| ID | Invariant |
|---|---|
| **FIN-AP-001** | Supplier Payable is financial liability truth, not `Supplier.balance`. |
| **FIN-AP-002** | A Supplier Quote never creates a Payable. |
| **FIN-AP-003** | A Draft PO never creates a Payable. |
| **FIN-AP-004** | PO commitment and Supplier Payable are distinct. |
| **FIN-AP-005** | Liability recognition must be traceable to its canonical source (GRN item / opening / allocation). |
| **FIN-AP-006** | Partial receipt recognizes only the qualifying received obligation (POSTED GRN accepted qty). |
| **FIN-AP-007** | Supplier Payable currency preserves contractual currency. |
| **FIN-AP-008** | FX_CREDIT principal is not rewritten when FX rates change. |
| **FIN-AP-009** | Supplier Payable creation does not move Cash. |
| **FIN-AP-010** | Outstanding Payable is derived/reconcilable. |
| **FIN-AP-011** | Outstanding Payable cannot be manually overwritten. |
| **FIN-AP-012** | Posted liability movements are immutable. |
| **FIN-AP-013** | Corrections create explicit liability movements. |
| **FIN-AP-014** | Supplier Returns create explicit liability reductions. |
| **FIN-AP-015** | Normal Payable outstanding cannot become negative. |
| **FIN-AP-016** | Excess Supplier value is preserved as Supplier Credit (or equivalent explicit position). |
| **FIN-AP-017** | Payment allocation cannot exceed available Payable under normal allocation flow. |
| **FIN-AP-018** | Different currencies are never silently aggregated. |
| **FIN-AP-019** | Due/Overdue state derives from outstanding and due date. |
| **FIN-AP-020** | Cross-company references are forbidden. |
| **FIN-AP-021** | Source processing is idempotent. |
| **FIN-AP-022** | Concurrent operations cannot corrupt outstanding liability. |
| **FIN-AP-023** | Posted financial history cannot be hard deleted. |
| **FIN-AP-024** | Supplier Payable is distinct from Loan Liability. |
| **FIN-AP-025** | Supplier Payable is distinct from Revenue and Capital. |

Operational locks: unique recognition per `goodsReceiptItemId`; ORDERED-only = no payable; allocation foundation posts no Account OUT (Phase 4.6).

## Outstanding formula

```text
recognized  = Σ INCREASE movements
decreased   = Σ DECREASE movements
outstanding = recognized − decreased
```

Never an editable column.

## Recognition trigger

```text
POSTED Goods Receipt item qty × PO item unitPrice
  → SupplierPayableLine (unique goodsReceiptItemId)
  → SupplierLiabilityMovement INCREASE PURCHASE_RECOGNITION
  → no FinancialAccountMovement
```

Hook: `GoodsReceiptsService.post()` → `SupplierPayablesService.recognizeFromPostedGoodsReceiptInTx` (same TX).

## Returns

```text
SRE DISPATCHED
  → FIFO reduce open payables (dueDate, recognizedAt)
  → excess → SupplierCredit OPEN
  → no cash movement
```

Hook: `SupplierReturnExecutionsService.dispatch()` → `reduceFromSupplierReturnInTx`.

## Payment allocation contract (Phase 4.6 readiness)

Phase 4.4 ships **liability-only** allocation:

| Field | Role |
|---|---|
| `SupplierPaymentAllocation` | Posted allocation row (amount, currency, optional paymentSource*) |
| `PAYMENT_ALLOCATION` decrease | Canonical liability reduction |
| `paymentSourceType` / `paymentSourceId` | Reserved for future Payment document (4.6) |

**4.6 must:**

1. Create / post Payment (cash OUT via AccountMovementsWriter).
2. Call `allocateSupplierPaymentInTx` in the **same** transaction with `paymentSourceType/Id` set.
3. Never allocate without cash (or explicit non-cash settlement document).
4. Preserve currency match + over-allocate guards already in 4.4.
5. Keep idempotency via `requestId` on allocation.

4.4 UI/API allocation is a **foundation** for tests and admin backfill — production cash path lands in 4.6.

## FX settlement readiness (Phase 4.9)

| Today (4.4) | Deferred (4.9) |
|---|---|
| FX_CREDIT payable currency = obligation currency (e.g. USD) | Settlement FX gain/loss vs reference rate |
| `referenceFxRate` + base/quote snapshotted on payable | Payment in IRR against USD liability |
| No revaluation in place | Explicit FX settlement document + journal |
| Summary by currency only | Cross-currency payment workflow |

Changing PO `referenceFxRate` after recognition must **not** rewrite payable currency or recognized amounts.

## Models

- `SupplierPayable` — AP-######; purchaseType CASH \| TERM_CREDIT \| FX_CREDIT \| OPENING
- `SupplierPayableLine` — GRN item recognition slice (unique goodsReceiptItemId)
- `SupplierLiabilityMovement` — INCREASE / DECREASE ledger
- `SupplierCredit` — SC-######; excess return / credit notes
- `SupplierPaymentAllocation` — foundation for 4.6

## APIs

- `GET /finance/payables` · `GET /finance/payables/:id`
- `GET /finance/payables/summary` · `GET /finance/payables/aging`
- `GET /finance/suppliers/:supplierId/payables`
- `GET /finance/suppliers/:supplierId/statement`
- `POST /finance/payables/opening`
- `POST /finance/payables/:id/allocations` (liability only)

Permissions: `finance.payables.read` / `finance.payables.manage`.

## Integrity

`pnpm db:check:finance` includes payable checks (missing lines, currency, outstanding ≥ 0, tenant, duplicates, allocation ≤ recognized, return source/notes).
