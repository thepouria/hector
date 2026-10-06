# Internal Stock Transfer (Phase 3.11)

Related: `inventory-ledger.md`, `stock-balance.md`, `stock-classification.md`,
`warehouse-architecture.md`, `warehouse-invariants.md`.

## Source-of-truth hierarchy

```text
StockTransfer (business document)
        ↓
InventoryMovement Ledger (canonical quantity truth)
        ↓
InventoryBalance (On Hand projection)
```

Transfers **never** edit Balance or Movement history directly.
All quantity changes go through `InventoryLedgerService`.

## Lifecycle

```text
DRAFT → IN_TRANSIT → COMPLETED
DRAFT → CANCELLED
IN_TRANSIT → CANCELLED (return transit → original source)
```

| Status | Stock effect |
|---|---|
| **DRAFT** | No movements. Does **not** reserve On Hand. |
| **IN_TRANSIT** | Source reduced; equal qty in system **TRANSIT** position. Destination unchanged. |
| **COMPLETED** | Transit cleared; destination increased. |
| **CANCELLED** from DRAFT | No stock effect. |
| **CANCELLED** from IN_TRANSIT | Compensating movements return transit → source. Original dispatch movements remain. |

COMPLETED cannot be cancelled — create a reverse transfer.

## Transit architecture

Per company, system-managed:

- Warehouse `SYS-TRANSIT` (`isSystem=true`, hidden from normal warehouse lists)
- Location `IN-TRANSIT` (`type=TRANSIT`)

Company-owned inventory includes storage + transit.
Default inventory list/SKU warehouse breakdown **excludes** TRANSIT (`includeTransit=true` to show).

## Ledger pairs

**Dispatch** (per item, `sourceLineId = item.id`):

```text
TRANSFER_OUT source  -Q
TRANSFER_IN  transit +Q
```

**Complete** (per item, `sourceLineId = item.completeSourceLineId`):

```text
TRANSFER_OUT transit     -Q
TRANSFER_IN  destination +Q
```

**Cancel IN_TRANSIT** (`sourceLineId = item.cancelSourceLineId`):

```text
TRANSFER_OUT transit -Q
TRANSFER_IN  source  +Q
```

`sourceType=TRANSFER`, `sourceId=transferId`. Separate line UUIDs avoid unique-key collisions across phases (OUT/IN types repeat).

Each transfer line carries `classification` (default SELLABLE). All dispatch/complete/cancel
movements preserve that classification on both OUT and IN legs (WH-TRF-029).

## Conservation

At every stage:

```text
Company SKU total before = after
Net Σ(quantityDelta) for the transfer's movements = 0
```

## API (read-only Balance; explicit lifecycle commands)

```text
GET    /warehouse/transfers
POST   /warehouse/transfers
GET    /warehouse/transfers/:id
PATCH  /warehouse/transfers/:id          (DRAFT only; no status field)
POST   /warehouse/transfers/:id/items
DELETE /warehouse/transfers/:id/items/:itemId
POST   /warehouse/transfers/:id/scan-apply
POST   /warehouse/transfers/:id/dispatch
POST   /warehouse/transfers/:id/complete
POST   /warehouse/transfers/:id/cancel
```

## RBAC

```text
warehouse.transfer.read
warehouse.transfer.manage
warehouse.transfer.dispatch
warehouse.transfer.complete
warehouse.transfer.cancel
```

## Invariants (WH-TRF-*)

See `docs/warehouse-invariants.md` (WH-TRF-001 … WH-TRF-029).

## Out of scope

Reservations, Available-to-Sell, sales fulfillment, stock count/adjustment workflows,
FIFO/FEFO, valuation/COGS, marketplace sync.
