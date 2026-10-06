# Goods Receipts (Phase 3.4)

Canonical Warehouse **Goods Receipt / GRN** domain.

> Answers: **What physically arrived?**  
> Does **not** answer: how much stock we currently have.

Related: `warehouse-architecture.md`, `warehouse-invariants.md`,
`warehouse-purchasing-contract.md`, `purchase-receiving-contract.md`.

---

## Ownership

| Concern | Owner |
|---|---|
| Supplier, PO, PO Item, ordered qty, price, terms | Purchasing |
| Product / SKU / barcode | Catalog |
| Goods Receipt + Receipt Items + physical receipt facts | **Warehouse** |
| Batch / lot identity + GRN batch allocations | **Warehouse** (Phase 3.7 — see `batch-management.md`) |
| Putaway (location placement) | **Warehouse** (Phase 3.8 — see `putaway.md`) |
| InventoryMovement / StockBalance / FIFO | Warehouse — **later** |

---

## Models

### `GoodsReceipt`

```text
id, companyId, number (GRN-YYYY-NNNNNN)
warehouseId, purchaseOrderId, supplierId (denormalized = PO.supplierId)
status: DRAFT | POSTED | CANCELLED
receivedAt?, postedAt?, notes?
createdBy / postedBy / cancelledBy
version
```

### `GoodsReceiptItem`

```text
id, companyId, goodsReceiptId
purchaseOrderItemId, skuId (denormalized = PO item SKU)
quantity (> 0 integer)
notes?
batchAllocations[]  (Phase 3.7 — split of quantity across Batch rows)
```

Unique: `(goodsReceiptId, purchaseOrderItemId)`.

**No `locationId` on GRN items** — location placement is Putaway (Phase 3.8), not receiving.

---

## Supplier denormalization decision

`supplierId` is stored on GRN for list/filter/history.

Invariant (enforced on create + post):

```text
goodsReceipt.supplierId == purchaseOrder.supplierId
```

Never allow divergence.

---

## SKU denormalization decision

`skuId` is stored on receipt items for query/traceability.

Invariant:

```text
receiptItem.skuId == purchaseOrderItem.skuId
```

No SKU substitution in 3.4.

---

## Lifecycle

```text
DRAFT → POSTED
DRAFT → CANCELLED
```

- **DRAFT**: editable; does **not** affect PO received totals.
- **POSTED**: physical receipt fact; operational quantities immutable; terminal in 3.4.
- **CANCELLED**: abandoned draft only. `POSTED → CANCELLED` is forbidden.

---

## Quantity semantics

```text
postedReceived = Σ quantity of POSTED GRN items for the PO item
remaining = ordered − postedReceived − closedUnfulfilled
```

Draft quantities never reserve remaining capacity. Posting revalidates under lock.

---

## Over-receipt

Default: **FORBID**.

```text
finalizedReceivedQuantity <= orderedQuantity
```

per PO item. Concurrency-safe via `SELECT … FOR UPDATE` on PO (+ GRN) inside the post transaction.

---

## Posting transaction (atomic)

1. Lock GRN `FOR UPDATE` (same-GRN concurrent post → one winner)
2. Verify DRAFT, ACTIVE warehouse, non-empty items, PO/SKU consistency
3. Verify **full batch allocation** per item (Σ allocations = item quantity) — Phase 3.7
4. Aggregate all POSTED quantities + this GRN’s items
5. `PurchaseReceivingContract.applyPostedReceivingEvidence` (locks PO, validates over-receipt, updates PO status)
6. Mark GRN `POSTED`, set `postedAt` / `receivedAt`
7. Audit + emit `warehouse.goods_receipt.posted` (+ purchasing receiving events when status changes)

**Does not** create InventoryMovement or StockBalance.

---

## Numbering

Server-generated `GRN-<UTC year>-######` via atomic sequence UPSERT (same pattern as PO/PR). Unique per `(companyId, number)`.

---

## API

```text
GET    /goods-receipts
GET    /goods-receipts/eligible-purchase-orders
GET    /goods-receipts/purchase-orders/:purchaseOrderId/progress
GET    /goods-receipts/:id
POST   /goods-receipts
PATCH  /goods-receipts/:id
POST   /goods-receipts/:id/scan/resolve
POST   /goods-receipts/:id/scan/apply
POST   /goods-receipts/:id/items
PATCH  /goods-receipts/:id/items/:itemId
DELETE /goods-receipts/:id/items/:itemId
PUT    /goods-receipts/:id/items/:itemId/batches
PATCH  /goods-receipts/:id/items/:itemId/batches/:allocationId
DELETE /goods-receipts/:id/items/:itemId/batches/:allocationId
POST   /goods-receipts/:id/post
POST   /goods-receipts/:id/cancel
```

Scanner endpoints: see `docs/barcode-scanner-receiving.md` (Phase 3.6).
They only mutate DRAFT GRN items; POST remains the receiving authority.

---

## RBAC

| Permission | Use |
|---|---|
| `warehouse.receipt.read` | List/get/progress/eligible POs |
| `warehouse.receipt.manage` | Draft CRUD + cancel draft + scanner resolve/apply |
| `warehouse.receipt.post` | Post physical receipt |

`WAREHOUSE_OPERATOR` seed role receives all three (+ `warehouse.read`).

Workers do **not** need Purchasing manage/approve merely to receive goods. Eligible PO list is exposed through the Warehouse receipt API.

---

## Events

| Event | When |
|---|---|
| `warehouse.goods_receipt.created` | Draft created |
| `warehouse.goods_receipt.posted` | Posted (payload: ids + itemIds) |
| `warehouse.goods_receipt.cancelled` | Draft cancelled |
| `purchasing.purchase_order.partially_received` | PO status → PARTIALLY_RECEIVED |
| `purchasing.purchase_order.received` | PO status → RECEIVED |

Future Inventory consumers should load the GRN aggregate by id — event payloads stay lean.

---

## Future Inventory contract

```text
GoodsReceiptPosted
      ↓ (later)
InventoryMovement(s)
      ↓
StockBalance
```

Phase 3.4 deliberately stops at the posted GRN fact.

Phase **3.5** adds the Purchase Receiving workflow (progress, short-close, outcomes) in
`docs/purchase-receiving.md` — still **no** InventoryMovement / StockBalance.

Phase **3.7** adds Batch / lot identity and per-line batch allocations (`docs/batch-management.md`).
**POST** requires each line’s quantity to be fully allocated to batch(es); line quantity remains the
canonical received amount for PO progress.
