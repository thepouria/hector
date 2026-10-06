# Stock Issue (Phase 3.12)

Manual **non-sales outbound** documents (samples, company use, damage disposal, etc.).

Related: `inventory-ledger.md`, `stock-balance.md`, `stock-classification.md`,
`warehouse-invariants.md`.

## Source-of-truth hierarchy

```text
StockIssue (business document)
        ↓
InventoryMovement ISSUE (canonical quantity truth)
        ↓
InventoryBalance (On Hand projection)
```

## Lifecycle

```text
DRAFT → POSTED
DRAFT → CANCELLED
```

| Status | Stock effect |
|---|---|
| **DRAFT** | No movements. Does not reserve On Hand. |
| **POSTED** | One `ISSUE` movement per line (`quantityDelta = −qty`). |
| **CANCELLED** | No stock effect (DRAFT only). POSTED cannot cancel. |

Numbering: `ISS-NNNNNN` per company (`StockIssueSequence`).

## Line position

Each `StockIssueItem` references:

```text
warehouseId (header) + locationId + skuId + batchId + classification + quantity
```

Classification defaults to SELLABLE when omitted on create/scan.

## Ledger posting

On POST (atomic across all lines):

```text
movementType = ISSUE
sourceType   = STOCK_ISSUE
sourceId     = issueId
sourceLineId = itemId
classification = item.classification
```

Post is **idempotent** when already POSTED.

## Scanner apply (DRAFT)

`POST /warehouse/issues/:issueId/scan-apply` upserts a line from location/product barcodes.
Idempotent by `requestId` (`StockIssueScanRequest`).

## API summary

| Method | Path | Permission |
|---|---|---|
| GET | `/warehouse/issues` | `warehouse.issue.read` |
| GET | `/warehouse/issues/:id` | `warehouse.issue.read` |
| POST | `/warehouse/issues` | `warehouse.issue.create` |
| PATCH | `/warehouse/issues/:id` | `warehouse.issue.update` |
| POST | `/warehouse/issues/:id/items` | `warehouse.issue.update` |
| DELETE | `/warehouse/issues/:id/items/:itemId` | `warehouse.issue.update` |
| POST | `/warehouse/issues/:id/scan-apply` | `warehouse.issue.update` |
| POST | `/warehouse/issues/:id/post` | `warehouse.issue.post` |
| POST | `/warehouse/issues/:id/cancel` | `warehouse.issue.cancel` |

## Seed fixture (Pishteh)

- **ISS-000001** SAMPLE POSTED 10 (SELLABLE, A-03)
- **ISS-000002** COMPANY_USE POSTED 2 (SELLABLE, A-03)
- **ISS-000003** DAMAGE DRAFT 3 (DAMAGED, A-03)

## Invariants (WH-ISS-*)

See `docs/warehouse-invariants.md` (WH-ISS-001 … WH-ISS-018).
