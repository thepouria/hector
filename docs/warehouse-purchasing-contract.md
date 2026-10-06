# Warehouse ↔ Purchasing Contract (Phase 3.1)

Formal boundary between **Purchasing (Phase 2)** and **Warehouse (Phase 3)**.

Implements / extends the Phase 2.10 receiving contract:

```text
apps/api/src/modules/purchasing/contracts/
  purchase-receiving.contract.ts
  purchase-receiving.service.ts
  purchase-receiving.policy.ts
  purchase-receiving.types.ts
```

Docs: `purchase-receiving-contract.md`, `purchase-returns-corrections.md`, `purchasing-events.md`.

> Phase 3.1 locked ownership, eligibility, over-receipt policy, and recovery principles.  
> **Phase 3.4** implements Goods Receipt tables/APIs and realizes
> `PurchaseReceivingContract.applyPostedReceivingEvidence` on post.  
> **Phase 3.5** adds canonical receiving progress, short-close vs post concurrency, and
> fully-received vs closed-with-shortage outcomes.  
> See `docs/goods-receipts.md` and `docs/purchase-receiving.md`.

---

## Ownership split

| Concern | Owner |
|---|---|
| Supplier, PO, PO Item | Purchasing |
| Ordered quantity | Purchasing (`PurchaseOrderItem.quantity`) |
| Purchase price, type, FX obligation, due date, purchase costs | Purchasing |
| Short-close (`closedUnfulfilledQuantity`) | Purchasing |
| Purchase Return **intent / approval** | Purchasing |
| Goods Receipt / Receipt Items | **Warehouse** |
| Physically accepted received quantity | **Warehouse** |
| Batch, location, movements, stock, FIFO | **Warehouse** |
| Physical supplier-return dispatch | **Warehouse** |
| Supplier refund / payable change | Finance — FUTURE |

```text
Purchasing owns:  What did we order?
Warehouse owns:   What physically arrived / left?
```

---

## Identity exchange

Warehouse links by **stable IDs** only — never product name, SKU code string, barcode text, or array index.

```text
companyId
purchaseOrderId          → PurchaseOrder.id
purchaseOrderItemId      → PurchaseOrderItem.id
supplierId               → Supplier.id
skuId                    → Catalog Sku.id  (same company as PO item)
orderedQuantity          → PurchaseOrderItem.quantity (integer)
closedUnfulfilledQuantity→ PurchaseOrderItem.closedUnfulfilledQuantity
```

Validation rule:

```text
GoodsReceiptItem.skuId == PurchaseOrderItem.skuId
```

Wrong scanned SKU for a PO line → reject / explicit discrepancy. Never silently add SKU-B to the PO.

---

## Existing read port (Phase 2)

```ts
PurchaseReceivingContract
  getReceivingContext(company, purchaseOrderId): PurchaseReceivingContext
  assertReceivingAllowed(company, purchaseOrderId): PurchaseReceivingContext
  recalculateReceivingStatus(orderedLines, acceptedReceived): summary status
  applyPostedReceivingEvidence(tx, { companyId, purchaseOrderId, acceptedReceived })
  hasPostedReceivingEvidence(companyId, purchaseOrderId, tx?)
```

Context shape (narrow DTOs — not Prisma entities):

```text
purchaseOrderId, companyId, status, supplierId
items[]: purchaseOrderItemId, skuId, orderedQuantity, closedUnfulfilledQuantity
```

Warehouse supplies normalized **accepted received** evidence; Purchasing owns summary projection onto:

```text
ORDERED | PARTIALLY_RECEIVED | RECEIVED
```

---

## Receipt eligibility

Warehouse may post receipts only when PO status is:

```text
ORDERED
PARTIALLY_RECEIVED
```

Rejected by policy today:

| Status | Why |
|---|---|
| DRAFT | Not committed |
| APPROVED | Not yet ordered from supplier |
| CANCELLED | Terminated |
| RECEIVED | Complete under default over-receipt forbid |

Company isolation:

```text
warehouse.companyId == purchaseOrder.companyId
```

---

## `PurchaseOrderOrdered` semantics

| Fact | Truth |
|---|---|
| Event type | `purchasing.purchase_order.ordered` |
| Meaning | Signal that PO became ORDERED |
| Creates stock? | **No** |
| Canonical PO data? | **No** — query Purchasing |
| Delivery | In-process only (not durable) |

### Event reliability (current)

```text
Durable: NO
In-process: YES
Transactional Outbox: NO
Crash-safe after commit: NO
```

### Miss recovery (required principle)

Warehouse must be able to discover receivable POs by **querying Purchasing** for eligible statuses (`ORDERED`, `PARTIALLY_RECEIVED`) rather than relying exclusively on event delivery.

Polling implementation is deferred; the architecture forbids “events-only” correctness.

---

## Partial / multiple receipts

Supported:

```text
Ordered = 100
GRN-001 = 40
GRN-002 = 30
GRN-003 = 30
acceptedReceived = 100
```

Also supported: multiple batches per PO item across one or many receipts.

```text
received quantity = Σ POSTED (non-reversed) receipt quantities for that line
```

Do not store client-mutable `PurchaseOrderItem.receivedQuantity` as independent truth.

---

## Over-receipt policy (Phase 3.1 decision)

```text
Default: FORBID
acceptedReceived ≤ ordered   (per PO line)
```

Example:

```text
Ordered = 100
Already accepted = 90
Attempt = 15
→ Reject (PURCHASE_ORDER_OVER_RECEIPT_NOT_ALLOWED)
```

Already enforced in `derivePurchaseReceivingStatus` / receiving policy.

Future override (permission + reason + audit) may be added later — **not** part of early receiving.

Short-close does **not** expand receive capacity.

---

## Short receipt vs commercial closure

```text
Ordered 100, accepted 90
```

is a valid physical short receipt.

It does **not** automatically close commercial remaining quantity. Purchasing short-close / correction / discrepancy flows own commercial closure (`closedUnfulfilledQuantity`).

Approximate remaining expected:

```text
remainingExpected ≈ ordered − acceptedReceived − closedUnfulfilled
```

Line complete for receiving summary when:

```text
acceptedReceived + closedUnfulfilled >= ordered
```

---

## Receipt lifecycle vs Purchasing status

```text
DRAFT receipt  → no stock, no PO summary change
POSTED receipt → accepted evidence → Purchasing recalculates summary
                 (Phase 3.4: no InventoryMovement / stock yet)
REVERSAL       → compensating evidence → Purchasing may move RECEIVED → PARTIALLY_RECEIVED → ORDERED
                 (reversal workflow not in 3.4)
```

System recalculation is **not** a public Purchasing user lifecycle command.

### Cancellation interaction (Phase 3 must enforce)

```text
ORDERED + zero posted receipts → cancel may remain allowed
any posted receipt exists      → normal PO cancellation forbidden
```

Concurrent cancel vs post-receipt needs transactional eligibility in operational receiving.

---

## Cost basis read requirements

Warehouse/FIFO may read Purchasing commercial inputs for acquisition provenance:

```text
PO item unit price
currency
purchase type
FX obligation + reference rate (reference valuation only)
allocated / allocable purchase costs (courier, shipping, fee, other)
```

Open policy (later FIFO phase): allocation by quantity / value / weight / manual.

Warehouse must **not** invent:

```text
supplier paid
settled FX rate
payable balance
```

---

## Supplier return boundary

```text
PurchaseReturnApproved (Purchasing commercial intent)
        ↓
SupplierReturnExecution DISPATCHED (Phase 3.14)
        ↓
RETURN_OUT movement (`sourceType=SUPPLIER_RETURN`)
        ↓
physical On Hand decreases
```

No automatic inventory effect from return **approval** alone.
No Finance refund implied by Warehouse dispatch.

---

## Dependency rule

```text
Catalog ← Purchasing ← Warehouse (consumes Purchasing contract)
```

- Warehouse may depend on Purchasing receiving contract + cost reads.
- Warehouse must not mutate Purchasing tables directly.
- Purchasing must not import Warehouse services/modules.
- Preferred interaction after post: Warehouse notifies / supplies evidence → Purchasing recalculates summary via contract/policy.

---

## Contract checklist

| Question | Answer |
|---|---|
| Reference PO by stable ID? | **YES** |
| Reference PO Item? | **YES** |
| Obtain SKU ID? | **YES** |
| Obtain ordered quantity? | **YES** |
| Obtain Supplier? | **YES** |
| Obtain company? | **YES** |
| Determine receipt eligibility? | **YES** |
| Partial receipts? | **YES** |
| Multiple receipts? | **YES** |
| Prevent default over-receipt? | **YES** |
| Physical supplier return separate from commercial intent? | **YES** |
| Recover if `PurchaseOrderOrdered` missed? | **YES** (query eligible POs) |
