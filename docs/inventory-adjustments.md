# Inventory Adjustment (Phase 3.13)

Manual **ledger corrections** (found stock, missing units, registration fixes).

Related: `inventory-ledger.md`, `stock-balance.md`, `stock-counts.md`,
`warehouse-invariants.md`.

## Source-of-truth hierarchy

```text
InventoryAdjustment (business document)
        ↓
InventoryMovement ADJUSTMENT_IN/OUT (canonical quantity truth)
        ↓
InventoryBalance (On Hand projection)
```

## Lifecycle

```text
DRAFT → PENDING_APPROVAL → APPROVED → POSTED
DRAFT / PENDING → CANCELLED or REJECTED
```

| Status | Stock effect |
|---|---|
| **DRAFT** | No movements. |
| **POSTED** | One `ADJUSTMENT_IN` or `ADJUSTMENT_OUT` per line. |
| **POSTED** | Immutable — use a compensating adjustment instead of cancel. |

Numbering: `ADJ-NNNNNN` per company (`InventoryAdjustmentSequence`).

## Line position

Each `InventoryAdjustmentItem` references:

```text
warehouseId (header) + locationId + skuId + batchId + classification + direction + quantity (> 0)
```

Ledger sign: `IN → +quantity`, `OUT → −quantity`.

## Ledger posting

On POST (atomic across all lines):

```text
movementType = ADJUSTMENT_IN | ADJUSTMENT_OUT
sourceType   = MANUAL_ADJUSTMENT
sourceId     = adjustmentId
sourceLineId = itemId
```

Post is **idempotent** when already POSTED.

## Seed fixture (Pishteh)

- **ADJ-000001** FOUND POSTED +5 SELLABLE (A-03, ESS-MASCARA-01, LOT-001)
- **ADJ-000002** MISSING POSTED −2 SELLABLE (same position)
- **ADJ-000003** CORRECTION DRAFT (`reasonText`, no movements)

## Invariants (WH-ADJ-*)

See `docs/warehouse-invariants.md` (WH-ADJ-001 … WH-ADJ-016).
