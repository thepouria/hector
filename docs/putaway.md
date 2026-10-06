# Putaway (Phase 3.8)

Maps **POSTED** receipt batch allocations to **warehouse locations**.

> Answers: **Where were received units originally placed?**  
> Does **not** answer: current on-hand stock in a location.

Related: `batch-management.md`, `goods-receipts.md`, `inventory-ledger.md`,
`stock-balance.md`, `warehouse-locations.md`, `warehouse-invariants.md`,
`warehouse-architecture.md`.

---

## Boundary

```text
POSTED GRN
  → GoodsReceiptItemBatch (received qty by SKU + Batch)
  → Putaway / PutawayItem (placement qty by Location)
```

Phase 3.8 documents historical placement. Phase **3.9** posts canonical
`RECEIVE` InventoryMovements when Putaway completes (exactly once per item).

Putaway itself is still not “current stock” — On Hand is the ledger projection
(see `inventory-ledger.md`, `stock-balance.md`). Do not invent Available / Reserved here.

---

## Source of truth

| Question | Owner |
|---|---|
| How much was received? | POSTED `GoodsReceiptItemBatch.quantity` |
| Where was it originally placed? | `PutawayItem` on `COMPLETED` Putaways |
| How much remains to put away? | received − Σ completed putaway qty |
| Current stock in location? | `InventoryBalance` / ledger (`stock-balance.md`) |

Putaway does not change received quantity or PO quantity.

---

## Data model

### Putaway

Document/session: `DRAFT` → `IN_PROGRESS` → `COMPLETED` | `CANCELLED`.

- Warehouse derived from GRN (`putaway.warehouseId === goodsReceipt.warehouseId`)
- Number: `PUT-######` (per company sequence)
- Partial documents allowed (multiple Putaways may consume one allocation)

### PutawayItem

```text
putawayId + goodsReceiptItemBatchId + warehouseLocationId + quantity > 0
UNIQUE (putawayId, goodsReceiptItemBatchId, warehouseLocationId)
```

SKU / Batch are derived from the allocation. Same allocation+location upserts (aggregates) within one Putaway.

---

## Lifecycle semantics

| Status | Meaning |
|---|---|
| `DRAFT` | Created; no items yet (or reset) |
| `IN_PROGRESS` | At least one placement line recorded |
| `COMPLETED` | Immutable historical placement; counts toward remaining |
| `CANCELLED` | Abandoned draft/in-progress; does not count |

Only **COMPLETED** putaway quantity is canonical placed quantity.

Draft capacity (UX):

```text
availableToAllocate =
  received − completed elsewhere − other lines on this putaway
```

Completion revalidates transactionally (locks putaway + capacity check).

---

## Remaining / receipt progress (derived)

```text
putawayRemaining = received − Σ(COMPLETED PutawayItem qty)

0           → NOT_PUT_AWAY
(0, received) → PARTIALLY_PUT_AWAY
received    → FULLY_PUT_AWAY
```

---

## Location rules

- Location must belong to Putaway warehouse + company
- Location must be `ACTIVE` (`LOCATION_NOT_AVAILABLE` otherwise)
- Exact location barcode resolve (trim-only; leading zeros preserved)
- Wrong warehouse → `LOCATION_NOT_IN_PUTAWAY_WAREHOUSE`
- Unknown barcode → `UNKNOWN_LOCATION_BARCODE` (no mutation)
- Product barcode and location barcode are separate contexts — resolve by scanner mode

---

## Scanner workflow

Recommended:

1. Open pending putaway / create Putaway from GRN
2. Select source row (SKU + Batch) or scan product in product context
3. Enter quantity
4. Scan **location** barcode (`EXPECT_LOCATION`)
5. Confirm / scan-apply (`requestId` idempotent)
6. Complete when ready

`POST /warehouse/putaways/:id/scan/apply` increments quantity for allocation+location.

---

## API (prefix `/api/v1`)

| Method | Path | Permission |
|---|---|---|
| GET | `/warehouse/putaways` | `warehouse.putaway.read` |
| GET | `/warehouse/putaways/pending` | `warehouse.putaway.read` |
| GET | `/warehouse/putaways/:id` | `warehouse.putaway.read` |
| POST | `/warehouse/putaways` | `warehouse.putaway.manage` |
| POST | `/warehouse/putaways/:id/items` | `warehouse.putaway.manage` |
| PATCH/DELETE | `/warehouse/putaways/:id/items/:itemId` | `warehouse.putaway.manage` |
| POST | `/warehouse/putaways/:id/location/resolve` | `warehouse.putaway.manage` |
| POST | `/warehouse/putaways/:id/scan/apply` | `warehouse.putaway.manage` |
| POST | `/warehouse/putaways/:id/complete` | `warehouse.putaway.complete` |
| POST | `/warehouse/putaways/:id/cancel` | `warehouse.putaway.manage` |

Client must not trust/send server-owned fields (`companyId`, `status`, `skuId`, `batchId`, …).

---

## Concurrency

Two workers may draft overlapping quantities. Final **complete** must ensure:

```text
Σ COMPLETED putaway ≤ received allocation
```

Failure code: `PUTAWAY_QUANTITY_EXCEEDED`.

---

## Audit & events

Audit: `PUTAWAY_CREATED`, `PUTAWAY_ITEM_UPSERTED`, `PUTAWAY_ITEM_REMOVED`,
`PUTAWAY_COMPLETED`, `PUTAWAY_CANCELLED`.

Domain event on complete: `warehouse.putaway.completed` (`PutawayCompleted`) — intended future
input for Inventory Ledger. **No ledger consumer in 3.8.**

---

## Integrity

`pnpm db:check:warehouse` includes putaway checks (posted GRN, warehouse match,
location company/warehouse, positive qty, no over-completed putaway, no cross-company).

---

## Invariants (WH-PUT-001 … WH-PUT-018)

| ID | Invariant |
|---|---|
| **WH-PUT-001** | Putaway maps POSTED received Batch quantity to Warehouse Locations. |
| **WH-PUT-002** | Putaway does not create a parallel receiving truth. |
| **WH-PUT-003** | Putaway preserves SKU and Batch provenance. |
| **WH-PUT-004** | Only POSTED Goods Receipts may be put away. |
| **WH-PUT-005** | Putaway quantity must be positive. |
| **WH-PUT-006** | Completed Putaway quantity may never exceed received Batch Allocation quantity. |
| **WH-PUT-007** | One received Batch Allocation may be split across multiple Locations. |
| **WH-PUT-008** | Multiple Putaways may consume one Receipt Batch Allocation. |
| **WH-PUT-009** | Putaway Location must belong to the correct Warehouse and Company. |
| **WH-PUT-010** | Inactive Locations cannot receive Putaway. |
| **WH-PUT-011** | Location barcode resolution is exact and warehouse-scoped. |
| **WH-PUT-012** | Draft Putaway is not canonical current inventory. |
| **WH-PUT-013** | Completed Putaway is immutable historical placement truth. |
| **WH-PUT-014** | Concurrent completion cannot cause over-putaway. |
| **WH-PUT-015** | Putaway does not expose fake Current Stock. |
| **WH-PUT-016** | Putaway operations are tenant isolated. |
| **WH-PUT-017** | Client cannot override server-derived SKU/Batch identity. |
| **WH-PUT-018** | Future Inventory Ledger may consume Completed Putaway as placement input. |
