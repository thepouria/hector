# Barcode Scanner Receiving (Phase 3.6)

Keyboard-wedge barcode scanning as an **input method** for DRAFT Goods Receipts.

Related: `goods-receipts.md`, `purchase-receiving.md`, `putaway.md`,
`warehouse-architecture.md`, `warehouse-invariants.md`, `catalog-architecture.md`.

> Scanning is **not** inventory truth. Canonical receiving truth remains
> `GoodsReceipt` + `GoodsReceiptItem`. No `InventoryMovement` / `StockBalance`.
> Location barcode scanning for Putaway is a separate scanner context (Phase 3.8).

---

## Scanner domain boundary

```text
Scanner UI / keyboard wedge
        ↓
Barcode string (never Number())
        ↓
Catalog exact resolve (company-scoped)
        ↓
SKU
        ↓
PO Item on the GRN's Purchase Order
        ↓
Create / increment DRAFT GoodsReceiptItem
        ↓ (optional Phase 3.7)
Resolve/create Batch + increment batch allocation on same line
```

Do **not** create parallel domains (`ScannerReceipt`, `ScannedInventory`, etc.).

---

## Input model

| Source | Supported in 3.6 |
|---|---|
| USB / Bluetooth keyboard-wedge scanner | Yes |
| Manual keyboard entry into same field | Yes |
| Camera / WebUSB / WebSerial / native SDK | Not required (same API later) |

Terminator: **Enter**. Submit once per terminator; reentrancy-guarded on the client.

Backend treats all sources as a barcode string. Hardware type is irrelevant.

---

## Barcode resolution

Reuses Catalog `BarcodesService.resolve`:

1. Normalize with Catalog rules (`normalizeScannedValue`) — **string**, preserves leading zeros
2. Exact match on `(companyId, normalizedValue)`
3. Archived barcode → not operational (`BARCODE_NOT_ACTIVE`)
4. Missing → `UNKNOWN_BARCODE` (same as not found in other tenants — no leak)

Multiple active barcodes for one SKU all resolve to that SKU (primary or not).

---

## SKU → PO Item

Match **only** within the GRN's Purchase Order.

| Outcome | Code / status |
|---|---|
| One PO line | `MATCHED` |
| Zero PO lines | `SKU_NOT_IN_PURCHASE_ORDER` |
| Multiple PO lines (should not happen: `UNIQUE(purchaseOrderId, skuId)`) | `AMBIGUOUS_PO_ITEM` — no guess |

Wrong SKU never mutates Catalog, PO, or GRN.

---

## Modes (UI session state)

| Mode | Behavior |
|---|---|
| **Scan + Quantity** (default) | Resolve → enter qty → `scan/apply` |
| **Each Unit** | Each scan calls `scan/apply` with `quantity: 1` |

Mode is not inventory truth and is not persisted server-side.

---

## Draft quantity semantics

```text
canonicalRemaining = ordered − postedReceived − closedUnfulfilled
availableToAdd     = canonicalRemaining − currentDraftQtyForPoItem
```

- Drafts do **not** reserve remaining quantity across concurrent DRAFT GRNs.
- Final **POST** remains the authority and revalidates (including **full batch allocation** per line in Phase 3.7).

---

## API

```http
POST /api/v1/goods-receipts/:id/scan/resolve
POST /api/v1/goods-receipts/:id/scan/apply
```

Permission: `warehouse.receipt.manage` (not a separate scan permission).
Posting remains `warehouse.receipt.post`.

### Resolve (no mutation)

Body: `{ "barcode": "..." }`

Returns structured `status` including `MATCHED`, `UNKNOWN_BARCODE`,
`SKU_NOT_IN_PURCHASE_ORDER`, `PO_ITEM_ALREADY_FULLY_RECEIVED`,
`PO_ITEM_RECEIVING_CLOSED`, etc.

### Apply (atomic)

Body: `{ "barcode": "...", "quantity": 20, "requestId": "<uuid>",
  "batchId"?, "supplierBatchNumber"?, "manufacturedAt"?, "expiresAt"? }`

Optional batch fields attach lot identity in the same atomic apply as quantity (DRAFT only).

Server derives barcode → SKU → PO item. Client `skuId` / `purchaseOrderItemId` are
**not accepted** (mass-assignment forbidden).

Idempotency scope: `(companyId, goodsReceiptId, requestId)`.

- Same `requestId` → apply once (`replayed: true` on retry)
- New `requestId` + same barcode → legitimate new physical scan

Concurrency: GRN row `FOR UPDATE` + `quantity: { increment }` so rapid unit scans
do not lose increments; capacity cannot overfill this Draft under concurrent applies.

---

## Errors (business, not 500)

| Code | Typical HTTP |
|---|---|
| `UNKNOWN_BARCODE` | 404 (apply) / status in resolve |
| `SKU_NOT_IN_PURCHASE_ORDER` | 409 |
| `AMBIGUOUS_PO_ITEM` | 409 |
| `PO_ITEM_ALREADY_FULLY_RECEIVED` | 409 |
| `PO_ITEM_RECEIVING_CLOSED` | 409 |
| `RECEIVING_QUANTITY_EXCEEDED` | 409 (+ remaining / draft / availableToAdd / requested) |
| `GRN_NOT_DRAFT` / posted immutable | 409 |
| `PURCHASE_ORDER_NOT_RECEIVABLE` | 409 |

---

## Audit & events

- Reuse `GOODS_RECEIPT_ITEM_ADDED` / `GOODS_RECEIPT_ITEM_UPDATED` with `source: "scanner"`.
- Do **not** emit `BarcodeScanned` domain events per physical scan.
- Session scan history is UI-only (ephemeral).

---

## Indexes (existing)

- Barcode: `@@unique([companyId, normalizedValue])`
- PO Item: `@@unique([purchaseOrderId, skuId])`
- GRN Item: `@@unique([goodsReceiptId, purchaseOrderItemId])`
- Scan idempotency: `@@unique([companyId, goodsReceiptId, requestId])`

---

## Seed

- Barcodes on `ESS-MASCARA-01`: `4059729196967`, `DEV-BC-ESS-MASCARA-01`, `0012345678905`
- `SEED-PO-SCANNER-01`: 100 ordered, 40 posted, 60 remaining
- `GRN-2026-000021`: empty DRAFT ready for scanning

---

## Future hardware

Industrial handhelds, mobile camera scanners, and PDAs should call the **same**
`scan/resolve` + `scan/apply` contract. No second receiving truth.
