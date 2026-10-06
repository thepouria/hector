# Warehouse Domain Events (Phase 3.17)

Reuse Phase 0 in-process `DomainEventBus` + `commitThenPublish`. **No Kafka / Outbox in this phase.**

> Events are currently process-local and not durable integration events.
> Dashboard recent activity must use Audit / operational docs / InventoryMovement — not the event bus.

## Delivery semantics

| Rule | Behavior |
| --- | --- |
| Emission | After successful DB commit (`commitThenPublish`) |
| Failed / rolled-back TX | No success event |
| Handlers | Synchronous after commit; failures logged; must not corrupt inventory truth |
| Idempotency | Handlers should tolerate duplicate delivery; command idempotency prevents duplicate logical facts |
| Version | Envelope `version` from factory (default 1) |
| Company | Payload and/or envelope carry `companyId` |

## Naming

Past-tense domain facts registered as stable string keys, e.g. `warehouse.goods_receipt.posted`.

Conceptual aliases used in product language:

| Product language | Registered type |
| --- | --- |
| GoodsReceived | `warehouse.goods_receipt.posted` |
| StockPutAway | `warehouse.putaway.completed` |
| StockTransferCompleted | `warehouse.stock_transfer.completed` |
| StockIssued | `warehouse.stock_issue.posted` |
| StockClassificationChanged | `warehouse.stock_classification.changed` |
| StockAdjusted | `warehouse.inventory_adjustment.posted` |
| StockCountCompleted | `warehouse.stock_count.completed` |
| SupplierReturnDispatched | `warehouse.supplier_return_execution.dispatched` |
| InventoryReserved | `warehouse.inventory.reserved` |
| InventoryReservationReleased | `warehouse.inventory.reservation_released` |
| InventoryReservationConsumed | `warehouse.inventory.reservation_consumed` |
| InventoryReservationExpired | `warehouse.inventory.reservation_expired` |

## Registry (selected)

| Event | When emitted | Aggregate | Payload (bounded) | Consumers today | Future |
| --- | --- | --- | --- | --- | --- |
| `warehouse.goods_receipt.posted` | GRN post succeeds | GoodsReceipt | companyId, receiptId, PO, warehouse, quantities | logging | Finance / availability |
| `warehouse.putaway.completed` | Putaway complete | Putaway | companyId, putawayId, warehouseId | logging | — |
| `warehouse.stock_transfer.dispatched` | Transfer to IN_TRANSIT | StockTransfer | companyId, transferId, warehouses | logging | — |
| `warehouse.stock_transfer.completed` | Transfer complete | StockTransfer | companyId, transferId, warehouses | logging | channel sync prep |
| `warehouse.stock_transfer.cancelled` | Transfer cancel | StockTransfer | companyId, transferId | logging | — |
| `warehouse.stock_issue.posted` | Issue post | StockIssue | companyId, issueId, warehouseId, reason | logging | Finance later |
| `warehouse.stock_classification.changed` | Reclassify succeeds | ClassificationChange | companyId, from/to, qty, sku | logging | availability |
| `warehouse.inventory_adjustment.posted` | Adjustment posts movements | InventoryAdjustment | companyId, adjustmentId, reason | logging | Finance later |
| `warehouse.stock_count.completed` | Count POSTED | StockCount | companyId, stockCountId, warehouseId, differenceLineCount, ±qty | logging | — |
| `warehouse.supplier_return_execution.dispatched` | Physical RETURN_OUT | SupplierReturnExecution | companyId, executionId, purchaseReturnId, warehouseId | logging | Finance later |
| `warehouse.inventory.reserved` | ACTIVE reservation created/increased | InventoryReservation | companyId, reservationId, warehouseId, skuId, qty | logging | Sales |
| `warehouse.inventory.reservation_released` | Release | InventoryReservation | companyId, reservationId | logging | Sales |
| `warehouse.inventory.reservation_consumed` | `consumeInTx` with events collector / `consume()` | InventoryReservation | companyId, reservationId, consumedQuantity | logging | Sales |
| `warehouse.inventory.reservation_expired` | Expire | InventoryReservation | companyId, reservationId | logging | Sales |
| `warehouse.inventory.cost_layer_created` | **Registered; not emitted yet** | InventoryCostLayer | — | — | Profit / Finance |
| `warehouse.inventory.cost_consumed` | **Registered; not emitted yet** | InventoryLayerConsumption | — | — | Profit / Finance |

Cost-layer events stay reserved to avoid noisy emission from every FIFO sync path until a durable integration phase.

## Semantics gates

- Draft GRN create → **no** GoodsReceived
- Draft adjustment → **no** StockAdjusted
- Draft return execution → **no** SupplierReturnDispatched
- Reservation → **no** InventoryMovement
- Failed insufficient stock → **no** success event / success audit / movement

## Availability change

Do not emit a generic `StockChanged` on every internal row. Future Phase 5 should derive availability from StockBalance + Reservations (and optionally react to the specific facts above).

## Correlation

Envelope carries `correlationId` / `requestId` from request context when present (bounded by Phase 0 infrastructure).
