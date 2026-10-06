# Inventory Movement Ledger (Phase 3.9)

Canonical accounting ledger of **physical inventory quantity**.

> Every stock change is an Inventory Movement.  
> On Hand is never manually overwritten.

Related: `stock-balance.md` (Phase 3.10), `stock-transfer.md` (Phase 3.11),
`stock-classification.md`, `stock-issue.md` (Phase 3.12),
`inventory-adjustments.md`, `stock-counts.md` (Phase 3.13),
`supplier-return-execution.md` (Phase 3.14 `SUPPLIER_RETURN` / `RETURN_OUT`),
`putaway.md`, `batch-management.md`, `warehouse-architecture.md`,
`warehouse-invariants.md`,
`inventory-dashboard.md` (Phase 3.17 read model — not ledger truth),
`warehouse-audit.md` (accountability; complements ledger).

---

## Philosophy

```text
Inventory is not CRUD.
Inventory is append-only ledger history.
```

Properties:

- append-only
- immutable after post
- auditable / rebuildable
- tenant-scoped
- deterministic posting via one service

---

## Source of truth

| Question | Answer |
|---|---|
| Current On Hand | `SUM(InventoryMovement.quantityDelta)` (or verified `InventoryBalance` projection) |
| How did it get here? | Movement history |
| Purchased stock at location | `RECEIVE` from **COMPLETED Putaway** |
| Correction | Compensating movement — never edit/delete |

Not inventory truth: GRN qty, Putaway qty, Batch row, Warehouse/Location masters.

---

## Position key

```text
companyId + warehouseId + locationId + skuId + batchId + classification
```

`batchId` is **required** for operational warehouse stock (batch-aware receiving).
`classification` is the operational inventory state (SELLABLE, TESTER, DAMAGED, QUARANTINE, …).

---

## Movement types (signed)

| Type | Sign |
|---|---|
| RECEIVE, TRANSFER_IN, RECLASSIFY_IN, ADJUSTMENT_IN, RETURN_IN, STOCK_COUNT_ADJUSTMENT_IN, OPENING_BALANCE | `quantityDelta > 0` |
| ISSUE, TRANSFER_OUT, RECLASSIFY_OUT, ADJUSTMENT_OUT, RETURN_OUT, STOCK_COUNT_ADJUSTMENT_OUT | `quantityDelta < 0` |
| SYSTEM_CORRECTION | nonzero either sign |

Zero delta is forbidden.

---

## Putaway → RECEIVE

```text
COMPLETED PutawayItem
  → exactly one RECEIVE (+qty)
  sourceType = PUTAWAY
  sourceId = putawayId
  sourceLineId = putawayItemId
```

Posted in the **same transaction** as Putaway completion. Unique DB constraint makes duplicates impossible.

GRN POST alone does **not** create location stock.

---

## InventoryBalance projection

```text
InventoryBalance.onHandQuantity = SUM(movements) for position
```

- Rebuildable cache
- Updated only by `InventoryLedgerService` with the movement
- `onHandQuantity >= 0`
- Zero rows may remain

If projection and ledger diverge: **Ledger wins**.

---

## Concurrency

Outbound posting:

1. `FOR UPDATE` balance row (or create+lock)
2. compute next On Hand
3. reject if `< 0`
4. insert movement
5. update balance

Transfers post OUT+IN in one transaction (shared `operationId` + `sourceLineId`).

---

## APIs (read)

| Method | Path | Permission |
|---|---|---|
| GET | `/warehouse/inventory` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/skus/:skuId` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/warehouses/:warehouseId` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/locations/:locationId` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/batches/:batchId` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/lookup` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/movements` | `warehouse.stock.read` |
| GET | `/warehouse/inventory/movements/:id` | `warehouse.stock.read` |

Current On Hand list/summary reads are served by `InventoryQueryService` (Balance projection).
Movement history remains ledger-backed. See `docs/stock-balance.md`.

No generic client `POST /movements` CRUD. Domain operations (putaway complete, future transfer/adjustment endpoints) call the posting service.

---

## Not in Phase 3.9 / 3.10

Stock Transfer / Issue / Adjustment / Count **workflows & UI**, reservations, Available-to-Sell,
Sales, Marketplace sync, FIFO/FEFO, valuation/COGS, Finance ledger.

Ledger **supports** those movement types internally for readiness.

---

## Integrity

`pnpm db:check:warehouse` verifies putaway RECEIVE coverage, sign/type agreement,
balance = ledger SUM, missing/orphan balances, non-negative balances, tenant/SKU/location consistency.

`pnpm db:check:inventory` is the dedicated Balance↔Ledger reconciliation CLI.
`pnpm inventory:reconcile` is the unified Phase 3.18 read-only gate (Balance, Reservations, FIFO, Valuation, ops docs, dashboard, tenant).
`pnpm db:rebuild:inventory-balances` rebuilds Balance from Ledger (admin only; supports `--dry-run`).

---

## Indexes & query notes

Useful indexes (migration):

- movements: `(company_id, occurred_at)`, `(company_id, sku_id, occurred_at)`,
  `(company_id, warehouse_id, occurred_at)`, `(company_id, location_id, occurred_at)`,
  `(company_id, batch_id, occurred_at)`, `(operation_id)`, unique source key
- balances: unique position key; `(company_id, sku_id)`, `(company_id, warehouse_id)`,
  `(company_id, location_id)`, `(company_id, batch_id)`

Bounded local sanity (dev seed scale + e2e fixtures): list/filter movements and
balances stay sub-second. Production EXPLAIN should prefer company-scoped indexes
above; avoid unbounded `SUM` without position filters for hot paths — use the
balance projection for current On Hand.
