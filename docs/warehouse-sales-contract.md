# Warehouse ↔ Sales Contract (Phase 3.1)

**Boundary contract only.** Sales / marketplace modules do not exist yet.

This document freezes ownership so Phase 5+ channels and future Sales can integrate without redesigning Warehouse.

Related: `warehouse-architecture.md`, `warehouse-invariants.md`.

---

## Ownership

| Concern | Owner |
|---|---|
| Physical stock, movements, balances, FIFO | **Warehouse** |
| Sellable / reserved / available quantities | **Warehouse** |
| Customer order / channel order | **Sales — FUTURE** |
| Why stock is reserved (order intent) | **Sales — FUTURE** |
| Marketplace listing content / price | Sales / Marketplace — FUTURE |
| Profit / COGS report | Profit Engine — FUTURE |

```text
Warehouse remains inventory source of truth.
Sales consumes Warehouse availability — never owns stock quantity.
```

---

## Availability

Conceptual query (not implemented):

```text
getAvailability(companyId, skuId, warehouseId?)
→ {
    sellableOnHand,
    reserved,
    available
  }
```

Definitions:

```text
SELLABLE_ON_HAND = physical qty in SELLABLE state
RESERVED         = active reservations
AVAILABLE        = SELLABLE_ON_HAND − RESERVED
```

Future extension:

```text
AVAILABLE_TO_SELL = SELLABLE_ON_HAND − RESERVED − SAFETY_STOCK
```

Safety stock and channel allocation limits are extension points — not implemented now.

---

## Reservation (Phase 5.3 live)

```text
Sales Order confirmed / reserve
  → request reservation (sourceType=SALES_ORDER, sourceId=orderId, sourceLineId=orderItemId)
  → Warehouse checks AVAILABLE
  → Reservation created (createInTx)
  → AVAILABLE decreases
  → physical On Hand unchanged
```

Critical:

```text
Reserve 10 units  ≠  InventoryMovement -10
```

Commercial reservation grain (recommended):

```text
companyId + warehouseId + skuId
```

Physical pick may later allocate specific `location` + `batch` without changing the commercial reservation model.

Release / expire / replace reservation must be first-class later.

---

## Fulfillment (Phase 5.3 live)

```text
SalesFulfillment COMPLETE
  → InventoryLedger ISSUE (sourceType=SALES_FULFILLMENT)
  → physical On Hand decreases
  → reservation consumed (consumeInTx)
  → FIFO layers consumed
  → Finance AR recognition (same outer TX; no bank cash)
```

Sales must **not**:

```text
PATCH StockBalance
create InventoryMovement directly
edit FifoLayer
```

Sales calls Warehouse services inside its outer transaction (`postMovementsInTx` / `createInTx` / `consumeInTx` / `releaseInTx`).

---

## Channel / marketplace principle

```text
                 WAREHOUSE
            Inventory Source of Truth
                     │
                     ▼
               Availability
                     │
       ┌─────────────┼──────────────┐
       ▼             ▼              ▼
    Khanoumi      Digikala       Pishteh / others
```

Forbidden architecture:

```text
Khanoumi stock + Digikala stock + WooCommerce stock
as independently trusted truths
```

Channels eventually sync **from** Warehouse availability. Channel-specific reservations / allocation caps must remain possible later without redesign.

---

## Idempotency

Future Sales/channel retries must not double-decrement stock or double-create reservations.

Warehouse reservation / fulfillment commands must eventually support idempotency keys (or equivalent). Not implemented in 3.1.

---

## Event note

`InventoryAvailabilityChanged` may help Sales/channels later, but high-volume fan-out needs careful design. Current DomainEventBus is **in-process / non-durable** — channel sync must not assume guaranteed delivery until an outbox (or equivalent) exists.

---

## Dependency direction

```text
Sales → Warehouse availability / reservation / fulfillment contracts
```

Not:

```text
SalesOrder.stockQuantity as canonical stock
Warehouse → Sales implementation
```

---

## Contract checklist

| Question | Architecturally possible? |
|---|---|
| Sales query availability? | **YES** |
| Sales reserve stock? | **YES** |
| Sales release reservation? | **YES** |
| Sales fulfill reservation? | **YES** |
| Warehouse remains stock SoT? | **YES** |
| Sales avoids directly changing stock? | **YES** (required) |
| Marketplaces sync from canonical availability? | **YES** |
| Multiple channels share one inventory truth? | **YES** |
| Future safety stock? | **YES** |
| Future channel allocation? | **YES** |
