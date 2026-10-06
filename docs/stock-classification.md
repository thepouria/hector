# Stock Classification Change (Phase 3.12)

Related: `inventory-ledger.md`, `stock-balance.md`, `warehouse-architecture.md`,
`warehouse-invariants.md`.

## Concept

**Classification** is a **position dimension** — not a SKU property.

```text
companyId + warehouseId + locationId + skuId + batchId + classification
```

Same SKU/batch/location may hold multiple classifications concurrently (SELLABLE, TESTER,
DAMAGED, QUARANTINE, …).

## Document model

`StockClassificationChange` is an immediate, posted document — **no DRAFT lifecycle**.

Each change posts atomically:

```text
RECLASSIFY_OUT  fromClassification  −Q
RECLASSIFY_IN   toClassification    +Q
```

- Shared `operationId` on both legs
- `sourceType = CLASSIFICATION_CHANGE`, `sourceId = changeId`, `sourceLineId = changeId`
- Company **physical SKU total is conserved** (quantity moves between classification buckets)

## API

| Method | Path | Permission |
|---|---|---|
| POST | `/warehouse/stock/classification-change` | `warehouse.classification.change` |
| GET | `/warehouse/stock/classification-changes` | `warehouse.stock.read` |

Optional `requestId` on POST acts as idempotency key (change document id).

## Validation

- `fromClassification ≠ toClassification`
- `quantity` positive integer
- Sufficient On Hand on **source classification** at the position
- Warehouse/location/batch/sku dimensions must align (company-scoped)

## Seed fixture (Pishteh)

On MAIN / A-03 / ESS-MASCARA-01 / LOT-001 (after inventory seed):

- SELLABLE → TESTER: 20
- SELLABLE → DAMAGED: 5
- SELLABLE → QUARANTINE: 10

## Invariants (WH-CLS-*)

See `docs/warehouse-invariants.md` (WH-CLS-001 … WH-CLS-015).
