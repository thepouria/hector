# FIFO Cost Layers (Phase 3.15)

Read-oriented API/UI: `docs/warehouse-api.md`, `docs/warehouse-ui.md`. Cost visibility requires `warehouse.cost_layer.read`.

## Scope decision

**Warehouse-scoped FIFO** per Company + Warehouse + SKU + Classification.

Rationale: inventory is held and transferred per warehouse; company-wide FIFO would break warehouse transfer cost preservation.

Location moves do **not** create new acquisition layers.

## Physical batch ≠ cost layer

`batchId` on a layer is optional provenance. Cost flow is layer-based, not batch-based.

## Creation

| Event | Layer |
|------|--------|
| Putaway RECEIVE | `GOODS_RECEIPT` valued from PO item `unitPrice` (+ FX reference → base). Unallocated PO costs ⇒ `PARTIALLY_VALUED`. |
| ADJUSTMENT_IN / STOCK_COUNT_IN / OPENING | `UNVALUED` (never fake 0) |
| Warehouse transfer / reclassify | Source layers consumed with `TRANSFER_OUT`/`RECLASSIFY_OUT`; destination layers created preserving unit cost |

## Ordering

`receivedAt ASC`, then `id ASC`.

## Consumption

Immutable `InventoryLayerConsumption` rows linked to `InventoryMovement`.

Supplier Return with PO item provenance prefers matching `purchaseOrderItemId` layers before generic FIFO.

Reservation does **not** consume layers.

## Acquisition cost

Foundation = PO line unit price snapshot (+ reference FX to company base).  
Purchase cost allocation is **not** invented in Phase 3.15 (UNALLOCATED ⇒ PARTIALLY_VALUED).

FX: preserve original currency/amount/reference rate. Do not revalue when market FX changes.

Phase 3.17: `warehouse.inventory.cost_layer_created` / `cost_consumed` are registered but **not emitted** yet (avoid noisy FIFO sync events until durable integration). See `docs/warehouse-domain-events.md`.

## Invariants

See WH-FIFO-001 … WH-FIFO-016.
