# Purchase Receiving Contract (Phase 2.10)

Architectural boundary between **Purchasing** and future **Warehouse** (Phase 3).

This phase defines the contract. It does **not** implement Warehouse, Goods Receipt tables, stock, FIFO, scanners, or landed-cost allocation.

Authority: `docs/purchasing-architecture.md`. Lifecycle: `docs/purchase-lifecycle.md`. PO core: `docs/purchase-orders.md`. Catalog barcodes: Catalog docs.

---

## Core principle

```text
Purchasing owns:  What did we order?
Warehouse owns:   What physically arrived?
```

Never merge these responsibilities.

```text
ORDERED quantity  ≠  received quantity
RECEIVED          ≠  PAID
status alone      ≠  stock truth
```

---

## Responsibility matrix

| Concern | Owner |
|---|---|
| PurchaseOrder / PurchaseOrderItem | Purchasing |
| Ordered quantity | Purchasing |
| Commercial price / currency / type / FX / credit / costs | Purchasing |
| GoodsReceipt / GoodsReceiptItem | Warehouse (Phase 3) |
| Accepted received quantity | Warehouse evidence |
| Batch / lot | Warehouse |
| Barcode → SKU resolution | Catalog (+ Warehouse scan workflow) |
| Warehouse / bin / location | Warehouse |
| Stock / inventory movement | Warehouse |
| FIFO layer | Future inventory costing |
| PO receiving summary status | Purchasing projection from Warehouse evidence |
| Supplier payment / payable | Finance |

---

## Identity contract

Future Warehouse must link by stable IDs — never by product name, SKU code string, barcode string, or array index.

```text
GoodsReceipt.purchaseOrderId
  → PurchaseOrder.id

GoodsReceiptItem.purchaseOrderItemId
  → PurchaseOrderItem.id

GoodsReceiptItem.skuId
  → Catalog Sku.id   (same company scope as PurchaseOrderItem.skuId)
```

Preferred validation:

```text
GoodsReceiptItem.skuId == PurchaseOrderItem.skuId
```

`PurchaseOrderItem.id` and `skuId` are immutable after ORDERED. Hard-delete of ORDERED POs/items is not a normal operation.

---

## Future conceptual model (NOT implemented)

```text
GoodsReceipt
  id, companyId, purchaseOrderId, warehouseId
  receiptNumber, receivedAt, status (DRAFT|POSTED|…), createdBy, createdAt

GoodsReceiptItem
  id, goodsReceiptId, purchaseOrderItemId, skuId
  quantity, batchNumber?
```

**Phase 2.10 creates none of these tables.**

Cardinality:

```text
PurchaseOrder     1 → N GoodsReceipt
PurchaseOrderItem 1 → N GoodsReceiptItem
GoodsReceipt      1 → N GoodsReceiptItem
```

One PO may be received across multiple receipts, batches, and (eventually) warehouses.

---

## Quantity semantics

| Concept | Meaning | Authority |
|---|---|---|
| `orderedQuantity` | What Purchasing committed on the PO line | `PurchaseOrderItem.quantity` |
| `acceptedReceivedQuantity` | Valid/accepted qty from finalized receipts | Σ GoodsReceiptItem (posted, not reversed) |
| `remainingQuantity` | `ordered − accepted` (subject to over-receipt / short-close policy) | Derived |

Do **not** add a client-mutable `PurchaseOrderItem.receivedQuantity`. That would create a second source of truth.

Do **not** rewrite ordered quantity to match receipts (short shipment ≠ silent quantity edit).

Current Hector quantities are positive integers (cosmetics).

---

## Receiving eligibility

Future Warehouse may post receipts only when PO status is:

```text
ORDERED
PARTIALLY_RECEIVED
```

Normally rejected:

| Status | Why |
|---|---|
| DRAFT | Not committed |
| APPROVED | Internal approval only — not ordered from supplier |
| CANCELLED | Terminated |
| RECEIVED | Complete under default policy (over-receipt is a Phase 3 extension) |

Company isolation:

```text
warehouse.companyId == purchaseOrder.companyId
```

Cross-company receipt → fail.

---

## Status derivation

Deterministic projection (pure function in Purchasing):

```text
derivePurchaseReceivingStatus(orderedLines, finalizedAcceptedEvidence)
→ ORDERED | PARTIALLY_RECEIVED | RECEIVED
```

Rules:

```text
all accepted = 0                         → ORDERED
any accepted > 0 and not all lines done  → PARTIALLY_RECEIVED
all lines accepted >= ordered            → RECEIVED
```

Missing receipt lines count as `accepted = 0`. Multiple receipts for one line are aggregated before derivation.

Default over-receipt policy: **reject** when accepted > ordered (**Phase 3.1 decision: FORBID**).
Future phases may add ALLOW_WITH_PERMISSION / TOLERANCE; early receiving must not silently allow over-receipt.
See `docs/warehouse-purchasing-contract.md`.

Only **finalized/posted** receipt evidence affects the projection. Draft Goods Receipts must not move PO lifecycle.

---

## System-derived recalculation (incl. reversal)

Normal business lifecycle is forward-moving for user commands.

When Warehouse reverses/corrects posted evidence, Purchasing must **recalculate** summary status from remaining evidence. That may move:

```text
RECEIVED → PARTIALLY_RECEIVED
PARTIALLY_RECEIVED → ORDERED
```

This is **not** a public Purchasing lifecycle action and not a manual rollback. It is a system projection of receipt truth.

Implementation helper: `canApplyReceivingSummaryTransition` in `purchase-receiving.policy.ts`.

---

## Cancellation interaction

```text
ORDERED + zero posted receipts → cancellation may be allowed (Phase 2.9 temporary rule)
any posted receipt exists      → normal PO cancellation forbidden (Phase 3 must enforce)
```

Phase 2 cannot query receipt evidence yet (no GoodsReceipt). Phase 3 must tighten `ORDERED → CANCELLED`.

Concurrent cancel vs post-receipt requires transactional eligibility checks in Phase 3.

---

## Discrepancy / short-close / return integration (Phase 2.11)

Purchasing now models commercial discrepancy + short-close separately from receiving evidence:

```text
orderedQuantity              → PurchaseOrderItem.quantity (never rewritten by receipts)
closedUnfulfilledQuantity    → Purchasing short-close projection
acceptedReceivedQuantity     → Warehouse posted receipt evidence (Phase 3)
remainingExpected            ≈ ordered − accepted − closedUnfulfilled
```

Derivation (pure policy) treats a line complete when:

```text
acceptedReceived + closedUnfulfilled >= ordered
```

Short shipment / short-close **must not** rewrite ordered quantity. Purchase returns are separate commercial intent (`PurchaseReturn`) and do not move receiving status by themselves. Receipt reversal still recalculates from remaining accepted evidence (+ short-close). Details: `docs/purchase-returns-corrections.md`.

---

## Application contract (port)

Location:

```text
apps/api/src/modules/purchasing/contracts/
  purchase-receiving.contract.ts   ← abstract port
  purchase-receiving.service.ts    ← Purchasing implementation
  purchase-receiving.policy.ts     ← pure eligibility + derivation
  purchase-receiving.types.ts      ← narrow DTOs
```

```ts
abstract class PurchaseReceivingContract {
  getReceivingContext(company, purchaseOrderId): Promise<PurchaseReceivingContext>;
  assertReceivingAllowed(company, purchaseOrderId): Promise<PurchaseReceivingContext>;
  recalculateReceivingStatus(orderedLines, acceptedReceived): PurchaseReceivingSummaryStatus;
}
```

Context returns only what Warehouse needs:

```text
purchaseOrderId, companyId, status, supplierId
items: purchaseOrderItemId, skuId, orderedQuantity
```

No Prisma entities handed across the boundary. No public HTTP receive endpoints.

### Dependency rule

```text
Catalog ← Purchasing ← Warehouse (uses Purchasing contract)
```

- Warehouse may depend on Purchasing receiving contract.
- Warehouse must **not** mutate Purchasing persistence directly.
- Purchasing must **not** depend on Warehouse implementation.

Preferred interaction:

```text
Warehouse finalizes Goods Receipt facts
  → calls Purchasing receiving contract / recalculation
  → Purchasing validates + updates summary status
  → Audit / Domain Events
```

Alternative later: `GoodsReceiptPosted` / `GoodsReceiptReversed` events → Purchasing recalculates (avoid event loops: Warehouse must not treat Purchasing events as new receipts).

---

## Barcode contract

```text
scan barcode
  → Catalog resolves barcode → SKU
  → Warehouse validates SKU against PO item
  → GoodsReceiptItem recorded
```

Barcode identifies SKU only — not PO, PO item, or receipt.

---

## Batch / location / multi-warehouse

- Batch belongs on Warehouse receipt/inventory — **not** on PurchaseOrderItem (one PO line may arrive in many batches).
- Shelf/bin/location belong to Warehouse — not Purchasing.
- Contract must not assume one company = one warehouse forever.

---

## Purchase costs / FIFO / Finance

- Receipt does not mutate `PurchaseOrderCost`, FX obligation, unit price, supplier, or purchase type.
- Landed-cost allocation and FIFO layers are future — but must eventually trace:

```text
Supplier → PO → PO Item → GoodsReceipt → GoodsReceiptItem → Inventory Movement → FIFO → COGS
```

- `RECEIVED` ≠ paid. Due dates from Phase 2.7 are not silently changed by receiving (future receipt-based terms are a separate extension).

---

## Error codes (stable)

| Code | When |
|---|---|
| `PURCHASE_ORDER_NOT_FOUND` | Missing / wrong company |
| `PURCHASE_ORDER_NOT_RECEIVABLE` | Status not ORDERED / PARTIALLY_RECEIVED |
| `PURCHASE_ORDER_CANCELLED` | Cancelled PO |
| `PURCHASE_ORDER_ALREADY_RECEIVED` | Fully received under default policy |
| `PURCHASE_ORDER_ITEM_NOT_FOUND` | Unknown PO item in evidence |
| `PURCHASE_ORDER_ITEM_MISMATCH` | Duplicate / inconsistent item identity |
| `PURCHASE_ORDER_RECEIVED_QUANTITY_INVALID` | Negative / non-integer qty |
| `PURCHASE_ORDER_OVER_RECEIPT_NOT_ALLOWED` | accepted > ordered |

---

## Domain events / Audit (future)

Purchasing may emit when summary changes:

```text
PurchaseOrderPartiallyReceived
PurchaseOrderReceived
```

Payload sketch: `companyId`, `purchaseOrderId`, `previousStatus`, `newStatus`, `sourceReceiptId?`.

Do **not** emit these without Warehouse evidence.

Warehouse Audit records physical receipt; Purchasing Audit records summary status change + correlation — not a full Goods Receipt dump.

---

## Architecture diagrams

```text
Catalog
  │ SKU / Barcode
  ▼
Purchasing
  │ PurchaseOrder / PurchaseOrderItem / ordered qty
  │ Purchase Receiving Contract
  ▼
Warehouse (Phase 3)
  │ GoodsReceipt / GoodsReceiptItem / batch / stock movement
  ▼
Inventory / FIFO
```

Traceability:

```text
Supplier → PurchaseOrder → PurchaseOrderItem
  → GoodsReceipt → GoodsReceiptItem
  → InventoryMovement → FIFO Layer → Sale/COGS
```

---

## Phase 3 implementation checklist

Do **not** implement in 2.10:

```text
□ Warehouse master + locations/bins
□ GoodsReceipt + GoodsReceiptItem tables
□ Link receipt → PO and receipt item → PO item
□ Resolve barcode → SKU; validate against PO item
□ Capture batch; destination warehouse
□ Validate remaining qty; over-receipt policy
□ Post receipt atomically; inventory movements; stock
□ Recalculate PO receiving status via Purchasing contract
□ Receipt reversal → Purchasing recalculation
□ Forbid PO cancel when posted receipts exist
□ Audit + events + RBAC + company isolation
□ Scanner UX
□ Short-close / damaged-vs-accepted QA (as needed)
□ Later: FIFO + landed-cost allocation
```

---

## Compatibility gate

Phase 3 must be buildable without redesigning:

```text
PurchaseOrder.id
PurchaseOrderItem.id
PurchaseOrderItem.skuId
PurchaseOrderItem.quantity
PurchaseOrderStatus
```

Additive changes only. Warehouse updates PO status only through this contract — **never** via direct Prisma mutation of `status`.
