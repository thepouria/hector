# Stock Count (Phase 3.13)

**Physical / cycle counts** with snapshot + expected reconciliation.

Related: `inventory-ledger.md`, `stock-balance.md`, `inventory-adjustments.md`,
`warehouse-invariants.md`.

## Source-of-truth hierarchy

```text
StockCount (session document)
        ↓
InventoryMovement STOCK_COUNT_ADJUSTMENT_IN/OUT (non-zero differences only)
        ↓
InventoryBalance (On Hand projection)
```

Corrections never overwrite `InventoryBalance` directly.

## Lifecycle

```text
DRAFT → IN_PROGRESS → SUBMITTED → APPROVED → POSTED
```

| Status | Stock effect |
|---|---|
| **DRAFT / IN_PROGRESS** | Snapshot frozen at start; no correction movements. |
| **POSTED** | One correction movement per line with `difference ≠ 0`. |

Numbering: `COUNT-NNNNNN` per company (`StockCountSequence`).

## Line fields

Each `StockCountItem` tracks:

```text
snapshotQuantity (at start)
countedQuantity (NULL = uncounted; 0 = explicit zero)
movementsDuringCount (net ledger on position during count)
expectedQuantity = snapshotQuantity + movementsDuringCount (at post)
difference = countedQuantity - expectedQuantity (at post)
```

## Ledger posting

On POST:

```text
movementType = STOCK_COUNT_ADJUSTMENT_IN | STOCK_COUNT_ADJUSTMENT_OUT
quantityDelta = difference (signed)
sourceType   = STOCK_COUNT
sourceId     = countId
sourceLineId = itemId
```

Lines with `difference = 0` post **no** movement.

## Seed fixture (Pishteh)

- **COUNT-000001** CYCLE POSTED, ESS-MASCARA-01 / LOT-001:
  - A-01: difference **−6**
  - A-02: difference **0**
  - A-04: difference **+3**

## Invariants (WH-CNT-*)

See `docs/warehouse-invariants.md` (WH-CNT-001 … WH-CNT-018).
