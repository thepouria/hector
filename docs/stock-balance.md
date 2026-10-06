# Stock Balance (Phase 3.10)

Rebuildable **On Hand** projection for current physical stock.

> Ledger is truth. Balance is cache.

Related: `inventory-ledger.md`, `stock-transfer.md` (Phase 3.11 transit),
`stock-classification.md`, `stock-issue.md` (Phase 3.12 classification dimension),
`inventory-adjustments.md`, `stock-counts.md` (Phase 3.13 corrections),
`supplier-return-execution.md` (Phase 3.14 supplier `RETURN_OUT`),
`putaway.md`, `warehouse-architecture.md`, `warehouse-invariants.md`.

Default inventory list excludes system **TRANSIT** positions (`includeTransit=true` to include).
Company SKU totals include in-transit On Hand; warehouse physical breakdown does not.

---

## Source-of-truth hierarchy

```text
Business Operation
        ↓
Inventory Movement Ledger   ← canonical
        ↓
Stock Balance (InventoryBalance)  ← derived projection
        ↓
Inventory Queries / UI / APIs
```

| Question | Answer |
|---|---|
| What is inventory truth? | `InventoryMovement` |
| What is StockBalance? | Derived current-state projection |
| Can StockBalance be rebuilt? | **YES** |
| Can Ledger be rebuilt from StockBalance? | **NO** |
| If they disagree, who wins? | **Ledger** |
| Can admin overwrite Balance via business API? | **NO** |

---

## Inventory position

```text
companyId + warehouseId + locationId + skuId + batchId + classification
```

`batchId` is **required** for operational warehouse stock (same as Phase 3.9).
PostgreSQL unique constraint on all six columns — SELLABLE and TESTER at the same
location/batch are distinct balance rows.

---

## On Hand definition

```text
onHandQuantity = SUM(InventoryMovement.quantityDelta)
```

for that inventory position.

**On Hand ≠ Available-to-Sell.** Phase 3.15 defines Available = SELLABLE On Hand − Active Reserved
(see `docs/inventory-reservations.md`). Reservations, channel allocation, safety stock,
and sellable math belong to later phases.

At this phase Balance stores **ON_HAND only** — not reserved / committed / allocated /
incoming / inTransit.

---

## Zero-balance policy

Keep rows with `onHandQuantity = 0`.

Reasons: simpler concurrency (row lock target remains), position identity, diagnostics.
Default inventory UI/API hides zeros; pass `includeZero=true` to show them.

Zero stock must **not** delete Ledger history.

---

## Atomic posting

Every canonical movement post (via `InventoryLedgerService`) in one transaction:

1. validate movement
2. lock/create `InventoryBalance` (`FOR UPDATE`)
3. validate resulting On Hand ≥ 0
4. insert `InventoryMovement`
5. update `InventoryBalance`
6. commit

Domain event `warehouse.inventory_movement.posted` may include `resultingOnHand`
generated in that same transaction. There is no independent `StockBalanceChanged` event.

Balance projection updates are **not** audited as user stock edits — the auditable
fact is the Movement. CLI rebuild logs structured progress (admin infrastructure).

---

## Query service

`InventoryQueryService` reads Balance for current stock:

| Endpoint | Purpose |
|---|---|
| `GET /warehouse/inventory` | Paginated position list (default `onHand > 0`) |
| `GET /warehouse/inventory/skus/:skuId` | Total + by warehouse / batch / location + hierarchy |
| `GET /warehouse/inventory/warehouses/:warehouseId` | Warehouse SKU breakdown |
| `GET /warehouse/inventory/locations/:locationId` | Contents of a location |
| `GET /warehouse/inventory/batches/:batchId` | Batch breakdown |
| `GET /warehouse/inventory/lookup` | Product or location barcode → On Hand |

Movement history remains on ledger endpoints (`…/movements`).

Permission: `warehouse.stock.read`.

**No** business `POST` / `PATCH` / `PUT` / `DELETE` for Balance quantity.

---

## Aggregation rules

All aggregates are `SUM(onHandQuantity)` from lowest-level Balance rows:

- By SKU — all warehouses / locations / batches
- By Warehouse (+ SKU)
- By Location
- By Batch
- Combinations via filters / SKU hierarchy drilldown

Product-level totals derive from SKUs — never a separate `Product.stock` truth.

Archived SKU / inactive Warehouse / inactive Location with On Hand remain visible
and flagged in API `warnings` / UI.

---

## Reconciliation

Internal `InventoryReconciliationService` + CLI:

```bash
pnpm db:check:inventory
```

Statuses: `MATCH` | `MISMATCH` | `MISSING_BALANCE` | `ORPHAN_BALANCE` | `INVALID_NEGATIVE`.

Read-only by default — reports and exits non-zero. Never silently repairs.

Also covered by `pnpm db:check:warehouse` (missing/orphan/mismatch checks).

---

## Rebuild

```bash
pnpm db:rebuild:inventory-balances
pnpm db:rebuild:inventory-balances -- --dry-run
pnpm db:rebuild:inventory-balances -- --company=<uuid>
```

- Reads Ledger, groups by position, writes Balance
- Deletes orphan Balance rows (no ledger movements)
- Keeps zero-balance rows for positions with movement history
- **Never** edits / deletes / invents Movements

Not exposed as a regular frontend/business API.

---

## Seed (Pishteh)

Ledger-first seed for `ESS-MASCARA-01`:

| Warehouse | Location | Batch | Approx On Hand |
|---|---|---|---|
| MAIN | A-01 | LOT-001 | 80 |
| MAIN | A-02 | LOT-001 | 50 |
| MAIN | A-03 | LOT-001 | 91 (putaway + seed) |
| MAIN | A-04 | LOT-001 | 50 |
| MAIN | A-03 | LOT-002 | 70 |
| SECONDARY | B-01 | LOT-002 | 25 |

Re-seed is idempotent (stable SEED `sourceLineId`s). Balance always rebuilt from
`SUM(movements)` in seed helper — never independent Balance-only inserts.

---

## Performance notes

Current-stock pages read `inventory_balances`, not full ledger `SUM`.

Useful indexes (already present):

- unique position key
- `(company_id, sku_id)`, `(company_id, warehouse_id)`, `(company_id, location_id)`, `(company_id, batch_id)`
- movement group/filter indexes from Phase 3.9

Local EXPLAIN on company-scoped filters should use those indexes. Reconciliation
groups ledger by position key (bounded samples in CLI).

---

## Future boundaries (not this phase)

Phase 3.15 adds Reservations + Available and FIFO valuation (see linked docs).
Still out of scope here: channel sync, sales fulfillment, COGS/profit, reorder intelligence.

Phase 5+ may reserve SELLABLE stock against On Hand / Available.

---

## Invariants

See `WH-BAL-*` in `docs/warehouse-invariants.md`.
