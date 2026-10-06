# Batch / Lot Management (Phase 3.7)

Canonical Warehouse **Batch (lot) identity** and **Goods Receipt batch allocation**.

> Answers: **Which lot did these received units belong to?**  
> Does **not** answer: how much stock we currently have on hand.

Related: `goods-receipts.md`, `purchase-receiving.md`, `barcode-scanner-receiving.md`,
`warehouse-invariants.md`, `warehouse-architecture.md`.

---

## Ownership

| Concern | Owner |
|---|---|
| Product / SKU | Catalog |
| PO, ordered qty, receiving progress | Purchasing |
| Batch identity (`Batch`) | **Warehouse** |
| GRN + GRN item received qty | **Warehouse** |
| GRN item → Batch split (`GoodsReceiptItemBatch`) | **Warehouse** |
| Putaway to locations | **Warehouse** (Phase 3.8 — see `putaway.md`) |
| InventoryMovement / On Hand | **Warehouse** (Phase 3.9 — see `inventory-ledger.md`) |
| FIFO / FEFO / reservations | Warehouse — **later** |

---

## Batch identity

A **Batch** is durable lot identity for one **SKU** within one **Company**.

| Field | Semantics |
|---|---|
| `batchNumber` | Hector internal operational id (`BAT-000001`, …). Server-assigned, **immutable**. Unique per `(companyId, batchNumber)`. |
| `supplierBatchNumber` | Optional supplier/manufacturer lot string. **Trim only** (no case folding). Leading zeros preserved. |
| `skuId` | Exactly one Catalog SKU per batch. **Immutable** after create. |
| `manufacturedAt` | Optional date. |
| `expiresAt` | Optional date. Expiry is **never required** to receive. |
| `notes` | Optional metadata. |

### Canonical uniqueness (database)

```sql
UNIQUE (company_id, batch_number)
UNIQUE (company_id, sku_id, supplier_batch_number)
  WHERE supplier_batch_number IS NOT NULL
```

Multiple batches for the same SKU with `supplierBatchNumber = NULL` are allowed (internal-only lots).

### SKU ownership (1:N)

One SKU has many Batches. A Batch never spans SKUs or Companies.

---

## Quantity semantics (critical)

Three concepts — only two exist in Phase 3.7:

| Concept | Phase 3.7 |
|---|---|
| **Lot identity** | `Batch` row (no quantity field) |
| **Received quantity (GRN line)** | `GoodsReceiptItem.quantity` — canonical for PO receiving |
| **Received quantity attributed to a lot** | `GoodsReceiptItemBatch.quantity` — split of the GRN line |
| **Current stock / on-hand** | Phase **3.9** — `SUM(InventoryMovement.quantityDelta)` by position incl. `batchId` |

`Batch` must **not** store a mutable inventory balance. Aggregates such as “total received on POSTED GRNs for this batch” are **derived read models**, not stock.

---

## GoodsReceiptItemBatch (allocation)

Links one **GRN item** to one **Batch** with a positive integer **allocated quantity**.

- One GRN item may split across **multiple batches** (several allocation rows).
- The **same Batch** may receive quantity from **multiple GRNs** (separate allocation rows).
- Unique pair: `(goodsReceiptItemId, batchId)`.
- Denormalized `skuId` on the allocation must match both the GRN item and the Batch.

Draft rules:

```text
Σ allocation.quantity ≤ goodsReceiptItem.quantity   (per item, DRAFT)
```

Post rule:

```text
Σ allocation.quantity = goodsReceiptItem.quantity   (every item, mandatory)
```

**GRN item quantity remains the canonical received quantity** for purchase receiving. Batch allocations explain *how that quantity is attributed to lots*; they do not replace the line quantity.

---

## Lifecycle: draft vs posted

| GRN status | Batch allocations |
|---|---|
| **DRAFT** | Create/update/delete allocations; create or resolve Batch by id/supplier number |
| **POSTED** | Allocations are **immutable** receipt history (same immutability as GRN line qty) |
| **CANCELLED** | Draft only; must not retain orphan allocations |

**POST** requires every item to be **fully batch-allocated** (`assertBatchAllocationsComplete`). Posting still does **not** create location On Hand — that happens when Putaway completes (Phase 3.9 RECEIVE).

---

## Scanner integration (Phase 3.6 + 3.7)

`scan/apply` may optionally attach batch context (`batchId`, `supplierBatchNumber`, dates). When provided, the server creates or resolves a Batch and upserts/increments the allocation on the affected DRAFT line in the **same transaction** as the quantity increment.

Scanner batch attach does not bypass POST validation or full-allocation rules.

---

## API (summary)

```text
GET    /batches
GET    /batches/:id
POST   /batches
PATCH  /batches/:id          (metadata only; not skuId / batchNumber)

PUT    /goods-receipts/:id/items/:itemId/batches
PATCH  /goods-receipts/:id/items/:itemId/batches/:allocationId
DELETE /goods-receipts/:id/items/:itemId/batches/:allocationId
```

Permissions: `warehouse.batch.read`, `warehouse.batch.manage` (+ existing receipt permissions for allocations).

---

## Invariants (WH-BATCH-001 … WH-BATCH-020)

See `warehouse-invariants.md` for the numbered table. Summary:

- Company-scoped Batch; SKU match; immutable `batchNumber` / `skuId`
- Optional supplier lot string with partial unique index when present
- No inventory quantity on Batch
- Positive allocation qty; SKU consistency; no duplicate (item, batch)
- POST = full allocation; GRN line qty stays canonical received qty
- Draft mutable / posted immutable allocations
- Same batch across receipts allowed
- No inventory quantity field on Batch (On Hand is ledger-derived in 3.9)

---

## Future readiness (not implemented)

Phase 3.7 intentionally prepares identity + receipt attribution only:

- **FIFO / FEFO** picking and expiry-driven rules
- **Recall** by batch / supplier lot
- **InventoryMovement** legs referencing `batchId` — Phase **3.9** (`docs/inventory-ledger.md`)
- **Putaway** to locations — Phase 3.8 (`docs/putaway.md`); preserves Batch provenance into RECEIVE

---

## Negative gate (must stay false)

```text
Batch.quantity stores current stock
Batch allocation replaces GoodsReceiptItem.quantity for receiving
Draft GRN POST without full batch allocation
Posted batch allocations editable
Cross-company Batch or allocation
Supplier batch number normalized beyond trim
Batch equals FIFO cost layer
GRN POST alone creates location On Hand
```

---

## Integrity script

Batch checks run in `pnpm db:check:warehouse` (`packages/database/scripts/warehouse-integrity-check.ts`). Read-only; never mutates data.
