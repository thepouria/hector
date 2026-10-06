# Inventory Reconciliation (Phase 3.18)

Read-only drift detection for Warehouse physical inventory truth.

## Command

```bash
pnpm inventory:reconcile
pnpm inventory:reconcile -- --company=<uuid>
```

Exit codes:

| Code | Meaning |
|------|---------|
| `0` | RESULT: OK — no violations |
| non-zero | RESULT: FAILED — drift detected |

## Critical rule

**Never auto-repairs.**

The reconciler must not `UPDATE` StockBalance, insert/delete Movements, repair FIFO, change Reservations, or rewrite valuation. Repairs require explicit operational workflows (`pnpm db:rebuild:inventory-balances` for Balance projection only, or operational documents for stock).

## Sections

| Section | Checks |
|---------|--------|
| Movement ↔ Balance | `StockBalance.onHand = SUM(InventoryMovement.quantityDelta)` per position |
| Reservations | Active reserved ≤ SELLABLE on hand; terminal remaining = 0 |
| FIFO | Layer bounds; `remaining + SUM(consumptions) = original`; physical = layer remaining |
| Valuation | No fake-zero valued costs |
| Operational Documents | Posted/completed docs have required movements |
| Dashboard | Company totals = warehouse sum; available formula |
| Tenant Integrity | Movement/balance company matches related entities |

## Related CLIs

| Script | Scope |
|--------|--------|
| `pnpm db:check:inventory` | Balance ↔ Ledger only |
| `pnpm db:check:warehouse` | Broad warehouse invariants |
| `pnpm db:check:valuation` | Reservation + FIFO + valuation |
| `pnpm inventory:reconcile` | Unified Phase 3.18 gate |

## Invariants

See `docs/warehouse-invariants.md` — **WH-INT-001 … WH-INT-030**.
