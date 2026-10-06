# Inventory Valuation Foundation (Phase 3.15)

Operational API/UI: `docs/warehouse-api.md`, `docs/warehouse-ui.md`. Requires `warehouse.valuation.read`.

Dashboard embeds valuation only when the actor has `warehouse.valuation.read` (`docs/inventory-dashboard.md`). Completeness warnings must stay visible when unvalued qty &gt; 0.

## Formula

```
Stock Value = SUM(remainingQuantity × baseCurrencyUnitCost)
  for layers where cost is known
```

Unvalued quantity is reported separately. Completeness is explicit: `VALUED` | `PARTIALLY_VALUED` | `UNVALUED`.

## Not Profit

Inventory Cost Consumption ≠ COGS. Phase 7 decides profit treatment.

## Reservation

Reservation does **not** reduce owned inventory value.

## Classification

TESTER / DAMAGED / QUARANTINE retain acquisition value until physically removed.

## Internal moves

Warehouse transfer, location transfer, and reclassification preserve company total value.

## APIs

- `GET /warehouse/valuation`
- `GET /warehouse/valuation/by-warehouse|by-sku|by-classification`
- `GET /warehouse/valuation/unvalued`
- `GET /warehouse/cost-layers`
- `GET /warehouse/inventory/movements/:id/cost-trace`

Permissions: `warehouse.valuation.read`, `warehouse.cost_layer.read` (sensitive; not default warehouse operator).

## Invariants

See WH-VAL-001 … WH-VAL-014.
