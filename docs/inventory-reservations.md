# Inventory Reservations (Phase 3.15)

Operational API/UI: `docs/warehouse-api.md`, `docs/warehouse-ui.md`.

## Truths

| Concept | Source |
|--------|--------|
| Physical On Hand | Inventory Movement Ledger → StockBalance |
| Reserved | ACTIVE `InventoryReservation.remainingQuantity` |
| Available | SELLABLE On Hand − Active Reserved |

Reservation **never** creates `InventoryMovement` and **never** changes On Hand or inventory valuation.

## Scope

Company + Warehouse + SKU, classification **SELLABLE** only.

Reservation ≠ picking allocation (no Batch/Location lock).

## Lifecycle

`ACTIVE` → `RELEASED` | `CONSUMED` | `EXPIRED` | `CANCELLED`

Only `ACTIVE` counts toward Reserved.

## Concurrency

`InventoryAvailabilityLock` row (`company + warehouse + sku`) is locked `FOR UPDATE` before create/increase/release.

No oversell under current policy (`Available >= Q`).

## Source contract

`sourceType`: `SALES_ORDER` | `MARKETPLACE_ORDER` | `MANUAL_OPERATION` | `OTHER`

Idempotency: unique `(companyId, requestId)` and `(companyId, sourceType, sourceId, sourceLineId)`.

## Future Sales

Phase 5 can: query availability (single + bulk), reserve, release, partially `consumeInTx` after physical outbound.

`consumeInTx` / `consume()` emit `warehouse.inventory.reservation_consumed` when an events collector is provided (Phase 3.17). Dashboard Reserved/Available read ACTIVE reservations only (`docs/inventory-dashboard.md`).

Do not implement Sales here.

## Invariants

See WH-RES-001 … WH-RES-012 in `docs/warehouse-invariants.md`.
