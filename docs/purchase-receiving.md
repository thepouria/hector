# Purchase Receiving (Phase 3.5)

Operational workflow connecting Purchase Orders to Goods Receipts.

> Answers: how much was ordered, physically received, still expected, or explicitly short?  
> Does **not** answer stock balance / InventoryMovement.

Related: `goods-receipts.md`, `barcode-scanner-receiving.md`,
`purchase-receiving-contract.md`, `warehouse-purchasing-contract.md`,
`warehouse-invariants.md`.

Scanner receiving (Phase 3.6) consumes the same `remainingQuantity` formulas and
never replaces POST validation.

Phase **3.7** batch splits (`GoodsReceiptItemBatch`) do not change Received formulas — still
Σ POSTED `GoodsReceiptItem.quantity`. POST additionally requires full batch allocation per line
(see `batch-management.md`).

Phase **3.8** Putaway places POSTED batch allocations into locations; it does not change
Received / Remaining PO formulas (see `putaway.md`).

---

## Source of truth (single formulas)

| Quantity | Definition | Owner |
|---|---|---|
| **Ordered** | `PurchaseOrderItem.quantity` | Purchasing (immutable by receiving) |
| **Received** | Σ POSTED `GoodsReceiptItem.quantity` | Warehouse physical fact |
| **Short** | `PurchaseOrderItem.closedUnfulfilledQuantity` (= Σ SHORT_CLOSED discrepancies) | Purchasing closure |
| **Remaining** | `ordered − received − short` | Derived |

Invariant:

```text
received + short + remaining = ordered
received + short ≤ ordered
remaining ≥ 0
```

Canonical API:

```text
GET /purchasing/purchase-orders/:id/receiving
GET /goods-receipts/purchase-orders/:id/progress   (same service)
```

---

## Shortage model (no new table)

Phase 3.5 **reuses** Phase 2.11:

- `closedUnfulfilledQuantity` on PO item = confirmed short quantity
- `PurchaseDiscrepancy` with `status=SHORT_CLOSED` = auditable shortage record

Do **not** invent fake negative GRNs. Short is never stock.

---

## Partial ≠ Short

Posting `90 / 100` leaves:

```text
received=90 short=0 remaining=10
```

Shortage requires explicit:

```text
POST .../items/:itemId/close-remaining
POST .../items/:itemId/short-close   (optional quantity; omit = all remaining)
```

Permission: `purchasing.po.short_close`.

---

## PO lifecycle decision

No `RECEIVED_WITH_SHORTAGE` enum (avoids destabilizing Phase 2).

When remaining = 0 for all items → `PurchaseOrder.status = RECEIVED`.

Distinguish outcomes via progress read model:

| `receivingOutcome` | Meaning |
|---|---|
| `AWAITING` | nothing received/short yet |
| `PARTIAL` | some remaining |
| `FULLY_RECEIVED` | remaining=0, short=0 |
| `CLOSED_WITH_SHORTAGE` | remaining=0, short>0 |

---

## Concurrency

GRN post and short-close both serialize on:

```text
SELECT … FROM purchase_orders … FOR UPDATE
```

So concurrent “post last 10” vs “close 10 short” yields exactly one consumer of remaining capacity.

---

## UI

PO detail → **وضعیت دریافت سفارش**:

- totals + per-line ordered/received/short/remaining
- receipt history
- shortage history
- Create GRN / Close remaining as short

---

## Future inventory

Only POSTED GRN quantities feed InventoryMovement later.  
Short quantity must never create stock.
