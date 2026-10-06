# Inventory Dashboard (Phase 3.17)

Operational **read model** for Warehouse. Never inventory truth.

## Source of truth

| Metric | Canonical source |
| --- | --- |
| Physical quantity history | `InventoryMovement` |
| Current On Hand | `InventoryBalance` (StockBalance projection) |
| Reserved | ACTIVE `InventoryReservation.remainingQuantity` |
| Available | `SELLABLE On Hand − Active Reserved` (computed) |
| Valuation | Remaining `InventoryCostLayer` rows |

Do **not** create competing tables such as `DashboardStock`.

## Endpoint

`GET /api/v1/warehouse/dashboard?warehouseId=`

Permission: `warehouse.stock.read`

Valuation section is included only when the actor has `warehouse.valuation.read`; otherwise `valuation: null` (not fetched and hidden on the client).

## Formulas (WH-DASH-*)

| KPI | Definition |
| --- | --- |
| **Total SKUs** | `COUNT DISTINCT skuId WHERE onHandQuantity > 0` |
| **Total Units** | `SUM onHandQuantity` for positions with `onHandQuantity > 0` |
| **Sellable / Tester / Damaged / Quarantine** | `SUM onHandQuantity` grouped by `StockClassification` |
| **Reserved** | `SUM remainingQuantity` where reservation `status = ACTIVE` |
| **Available** | `max(0, sellableUnits − reservedUnits)` |
| **Pending Receipts** | Goods receipts in `DRAFT` |
| **Pending Putaway** | Putaways in `DRAFT` |
| **Open Transfers** | Transfers in `DRAFT` or `IN_TRANSIT` |
| **Open Stock Counts** | Counts in `DRAFT`, `IN_PROGRESS`, or `SUBMITTED` |
| **Counts Awaiting Approval** | Counts in `SUBMITTED` |
| **Pending Supplier Return Executions** | Executions in `DRAFT` |
| **Pending Supplier Returns Open** | APPROVED purchase returns with dispatched qty &lt; approved qty |
| **Stock Discrepancies** | Counted lines on `SUBMITTED` counts where live Δ ≠ 0 |
| **Known Inventory Value** | Σ `remainingQuantity × baseCurrencyUnitCost` for non-UNVALUED layers |
| **Unvalued Quantity** | Σ remaining qty on UNVALUED (or null-cost) layers |
| **Valuation Completeness** | `VALUED` / `PARTIALLY_VALUED` / `UNVALUED` |

Reconciliation invariants:

- `totalUnits = sellable + tester + damaged + quarantine`
- `availableUnits = max(0, sellable − reserved)`
- Internal transfer cannot change company total units/value

## Performance

Aggregations use Prisma `groupBy` / `count` / bounded `findMany` with `ORDER BY … DESC LIMIT`. Do not load full ledgers into Node.

## UI

`/app/warehouse/dashboard` — drilldowns to inventory (warehouse/classification), reservations, operational queues, valuation (permission-gated), and entity detail for recent activity.
