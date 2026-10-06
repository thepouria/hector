# Supplier Return Execution (Phase 3.14)

Physical warehouse dispatch for **APPROVED** Purchase Returns (supplier-bound outbound).

Related: `purchase-returns-corrections.md`, `warehouse-purchasing-contract.md`,
`inventory-ledger.md`, `stock-balance.md`, `warehouse-invariants.md` (WH-SRET).

## Authority boundary

| Concern | Owner |
|---|---|
| Return intent, approval, commercial qty | **Purchasing** (`PurchaseReturn`) |
| Pick/pack/ship evidence, stock decrease | **Warehouse** (`SupplierReturnExecution`) |
| Supplier credit / refund / payable | **Finance** (future) |

Purchasing APPROVED does **not** post ledger movements. Warehouse **DISPATCHED** does.

## Source-of-truth hierarchy

```text
PurchaseReturn (commercial authorization — read-only in Warehouse UI)
        ↓
SupplierReturnExecution (operational document)
        ↓
InventoryMovement RETURN_OUT (canonical quantity truth)
        ↓
InventoryBalance (On Hand projection)
```

## Lifecycle

```text
DRAFT → DISPATCHED
DRAFT → CANCELLED
```

| Status | Stock effect |
|---|---|
| **DRAFT** | No movements. Does not reserve On Hand. |
| **DISPATCHED** | One `RETURN_OUT` movement per line (`quantityDelta = −qty`). |
| **CANCELLED** | No stock effect (DRAFT only). DISPATCHED cannot cancel. |

Numbering: `SRE-NNNNNN` per company (`SupplierReturnExecutionSequence`).

Multiple executions may fulfill one APPROVED return (partial dispatches across time/warehouses).

## Progress projection

For each APPROVED return:

```text
approvedQuantity   = Σ PurchaseReturnItem.quantity
dispatchedQuantity = Σ execution item qty where execution.status = DISPATCHED
remainingQuantity  = max(0, approved − dispatched)
fulfillmentStatus  = NOT_DISPATCHED | PARTIALLY_DISPATCHED | FULLY_DISPATCHED
```

DRAFT execution lines do **not** count toward `dispatchedQuantity` until dispatch.

## Line position

Each `SupplierReturnExecutionItem` references:

```text
execution.warehouseId + locationId + skuId + batchId + classification + quantity
purchaseReturnItemId (must match return line SKU)
```

Dispatch validates:

- SKU matches purchase return line
- Batch provenance matches return supplier (GRN path)
- Location belongs to execution warehouse
- Sufficient On Hand on line classification
- Σ DISPATCHED qty per return line ≤ authorized return line qty

## Ledger posting

On dispatch (atomic across all lines):

```text
movementType   = RETURN_OUT
sourceType     = SUPPLIER_RETURN
sourceId       = executionId
sourceLineId   = executionItemId
classification = item.classification
quantityDelta  = −item.quantity
```

Dispatch is **idempotent** when already DISPATCHED.

## APIs

| Method | Path | Permission |
|---|---|---|
| GET | `/warehouse/supplier-returns` | `warehouse.supplier_return.read` |
| GET | `/warehouse/supplier-returns/:purchaseReturnId` | `warehouse.supplier_return.read` |
| POST | `/warehouse/supplier-returns/:purchaseReturnId/executions` | `warehouse.supplier_return.create_execution` |
| GET | `/warehouse/supplier-return-executions` | `warehouse.supplier_return.read` |
| GET | `/warehouse/supplier-return-executions/:id` | `warehouse.supplier_return.read` |
| PATCH | `/warehouse/supplier-return-executions/:id` | `warehouse.supplier_return.update_execution` |
| POST | `/warehouse/supplier-return-executions/:id/items` | `warehouse.supplier_return.update_execution` |
| DELETE | `/warehouse/supplier-return-executions/:id/items/:itemId` | `warehouse.supplier_return.update_execution` |
| POST | `/warehouse/supplier-return-executions/:id/scan-apply` | `warehouse.supplier_return.update_execution` |
| POST | `/warehouse/supplier-return-executions/:id/dispatch` | `warehouse.supplier_return.dispatch` |
| POST | `/warehouse/supplier-return-executions/:id/cancel` | `warehouse.supplier_return.cancel_execution` |

## Scanner apply (DRAFT)

`POST …/scan-apply` upserts a line from location/product barcodes against a `purchaseReturnItemId`.
Idempotent by `requestId` (`SupplierReturnExecutionScanRequest`).

## UI (Web)

Persian warehouse nav: **برگشت به تأمین‌کننده**

- Queue: APPROVED returns with dispatch progress
- Return detail: commercial read-only + executions list
- Create execution: warehouse + optional notes (lines via scanner on detail)
- Execution detail: scanner panel + dispatch confirm

## Seed fixture (Pishteh)

- `SEED-PR-000002` — APPROVED 100 units (TEH-BEAUTY / `SEED-PO-RECEIVING-01`)
- QUARANTINE opening stock @ MAIN `A-01` / `LOT-001` (seed movement)
- `SRE-000001` DISPATCHED 40 → RETURN_OUT posted
- `SRE-000002` DRAFT 30 (no ledger)
- Projection: approved 100, dispatched 40, remaining 60

## Explicit non-goals (Phase 3.14)

- No `ReturnShipment` parallel model (use `SupplierReturnExecution`)
- No Finance credit/refund posting
- No reservations / ATS
- No reverse dispatch / undo RETURN_OUT (compensating movements only via future policy)
