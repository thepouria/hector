# Warehouse Architecture (Phase 3.1)

Hector Warehouse is the **physical inventory** domain.

It answers:

> What physically happened to goods — where are they, in what condition, from which receipt/batch, and how did every unit arrive or leave?

It does **not** answer commercial buy commitments, product identity, supplier payment, or sales profitability.

> **Implementation status:** Phases **3.1–3.17** implemented. Physical inventory domain (through reservations, warehouse-scoped FIFO, valuation foundation), operational Warehouse API/UI/Scanner Center, plus Inventory Dashboard read model, warehouse Audit timelines, and domain-event registry. Sales / Finance / Profit / Reorder intelligence remain out of scope. Next: Phase 3 Final QA only on explicit instruction.

Authority companions:

- `docs/warehouse-master.md` — Phase 3.2 Warehouse Master semantics
- `docs/warehouse-locations.md` — Phase 3.3 location hierarchy + barcodes
- `docs/goods-receipts.md` — Phase 3.4 Goods Receipt / GRN
- `docs/purchase-receiving.md` — Phase 3.5 Purchase Receiving workflow
- `docs/barcode-scanner-receiving.md` — Phase 3.6 keyboard-wedge scanner receiving
- `docs/batch-management.md` — Phase 3.7 Batch / Lot + GRN allocations
- `docs/putaway.md` — Phase 3.8 Putaway (placement history; posts RECEIVE in 3.9)
- `docs/inventory-ledger.md` — Phase 3.9 Inventory Movement Ledger
- `docs/stock-balance.md` — Phase 3.10 Stock Balance (On Hand projection)
- `docs/stock-transfer.md` — Phase 3.11 Internal Stock Transfer (transit lifecycle)
- `docs/stock-classification.md` — Phase 3.12 classification dimension + reclassify
- `docs/stock-issue.md` — Phase 3.12 manual outbound issues
- `docs/inventory-adjustments.md` — Phase 3.13 manual ledger adjustments
- `docs/stock-counts.md` — Phase 3.13 physical / cycle counts
- `docs/supplier-return-execution.md` — Phase 3.14 supplier return dispatch
- `docs/inventory-reservations.md` — Phase 3.15 On Hand / Reserved / Available
- `docs/fifo-cost-layers.md` — Phase 3.15 warehouse-scoped FIFO cost layers
- `docs/inventory-valuation.md` — Phase 3.15 acquisition valuation foundation
- `docs/warehouse-api.md` — Phase 3.16 Warehouse HTTP API surface
- `docs/warehouse-ui.md` — Phase 3.16 operational UI / navigation / cache
- `docs/scanner-ux.md` — Phase 3.16 scanner-first UX + resolvers
- `docs/inventory-dashboard.md` — Phase 3.17 operational dashboard read model
- `docs/warehouse-audit.md` — Phase 3.17 warehouse audit + entity activity
- `docs/warehouse-domain-events.md` — Phase 3.17 warehouse domain event registry
- `docs/warehouse-invariants.md` — numbered invariants
- `docs/warehouse-purchasing-contract.md` — Purchasing ↔ Warehouse
- `docs/warehouse-sales-contract.md` — future Sales ↔ Warehouse
- Phase 2: `docs/purchase-receiving-contract.md`, `docs/purchasing-invariants.md`
- Phase 1: `docs/catalog-invariants.md`

---

## Purpose

Establish a Warehouse foundation that can grow through:

```text
3.2  Warehouse Master
3.3  Locations
3.4  Goods Receipt / Receiving
3.5  Batch / Putaway
3.6  Inventory Movement Ledger
3.7  Stock Balance
3.8  Transfers / Issues / State changes
3.9  Adjustments / Stock Counts
3.10 Reservations / Availability
3.11 FIFO Layers (cost provenance)
3.12 Scanner UX
3.13 Warehouse API + UI
3.14 Tests + Final QA
```

without rewriting Catalog/Purchasing, inventing parallel SKU identity, or absorbing Finance/Sales authority.

---

## Core ownership principle

```text
Catalog      owns WHAT the item is.
Purchasing   owns WHAT WE ORDERED commercially.
Warehouse    owns WHAT PHYSICALLY HAPPENED to goods.
Finance      will own WHAT HAPPENED TO MONEY.
Sales        will own WHAT WE SOLD / ALLOCATED to customer/channel.
Profit       will own profitability / COGS reporting (consuming Warehouse facts).
```

---

## Source-of-truth matrix

| Fact | Canonical Owner |
|---|---|
| Product | Catalog |
| SKU | Catalog |
| Product Barcode | Catalog |
| Supplier | Purchasing |
| Purchase Order / Item | Purchasing |
| Ordered Quantity | Purchasing |
| Purchase Price / FX Obligation / Due Date / Purchase Costs | Purchasing |
| Purchase Return **intent** | Purchasing |
| Goods Receipt | **Warehouse** |
| Physically Received Quantity | **Warehouse** |
| Warehouse / Location | **Warehouse** |
| Batch / Lot | **Warehouse** |
| Inventory Movement | **Warehouse** |
| Physical On-Hand / Inventory State / Stock Balance | **Warehouse** |
| Reservation / Available-to-Sell | **Warehouse** |
| Stock Count / Adjustment / Internal Transfer | **Warehouse** |
| FIFO Layer / consumption provenance | **Warehouse** |
| Customer / Channel Order | Sales — FUTURE |
| Supplier Payable / Payment / Cash / FX Settlement | Finance — FUTURE |
| Profit / realized COGS report | Profit Engine — FUTURE |

---

## Domain diagram

```text
                    ┌──────────────────┐
                    │     CATALOG      │
                    │ Product / SKU    │
                    │ Product Barcode  │
                    └────────┬─────────┘
                             │
                             │ skuId
                             ▼
┌──────────────────┐   ┌──────────────────────┐
│    PURCHASING    │   │      WAREHOUSE       │
│                  │   │                      │
│ Supplier         │──▶│ Goods Receipt        │
│ PO               │   │ Batch                │
│ PO Item          │   │ Location             │
│ Ordered Qty      │   │ Movement Ledger      │
│ Purchase Cost    │   │ Stock Balance        │
│ Return Intent    │   │ Reservation          │
└──────────────────┘   │ FIFO Layers          │
                       └──────────┬───────────┘
                                  │
                                  │ availability /
                                  │ fulfillment
                                  ▼
                       ┌──────────────────────┐
                       │   SALES — FUTURE     │
                       │ Orders / Channels    │
                       └──────────────────────┘
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ PROFIT — FUTURE      │
                       │ FIFO Consumption     │
                       │ COGS / Profit        │
                       └──────────────────────┘
```

### Dependency direction

```text
Warehouse → Catalog (skuId, barcode resolve)
Warehouse → Purchasing read/contracts (PO context, cost basis reads)
Future Sales → Warehouse availability / reservation / fulfillment contracts
```

- Purchasing must **not** depend on Warehouse implementation.
- Warehouse must **not** mutate Purchasing persistence directly.
- Avoid circular module imports.

---

## Catalog boundary

- Warehouse references canonical `skuId` only.
- **Forbidden:** `WarehouseProduct`, `WarehouseSku`, `InventoryProduct`, `StockProduct` as duplicated masters.
- Product/SKU barcode identity stays in Catalog.
- Scanner path: `raw barcode → Catalog normalize/resolve → skuId` (exact; string; leading zeros preserved).
- Unknown / ambiguous barcode → fail closed. Never auto-create SKU from scan.

### Warehouse operational barcodes (separate namespace)

Warehouse may later own barcodes for:

```text
LOCATION / BIN labels
BATCH / LOT labels
GOODS_RECEIPT labels
TRANSFER container labels
```

These are **operational identifiers**, not Catalog product barcodes. Scanner context or explicit type must distinguish:

```text
PRODUCT barcode     → Catalog
LOCATION barcode    → Warehouse
BATCH barcode       → Warehouse
```

---

## Purchasing boundary

See `docs/warehouse-purchasing-contract.md`.

Summary:

- Purchasing owns ordered commercial quantity and PO lifecycle.
- Warehouse owns posted receipt evidence and physical stock effects.
- Receipts never rewrite `PurchaseOrderItem.quantity`.
- Default: `acceptedReceived ≤ ordered` (over-receipt rejected).
- `PurchaseOrderOrdered` is a **signal**, not master data; Warehouse must query Purchasing for canonical PO context and must recover if the in-process event is missed.

---

## Finance boundary

Warehouse must **not** own:

```text
supplier payable, payment, bank, cash, FX settlement, partner capital, profit
```

Warehouse may preserve **acquisition cost basis / reference valuation** on FIFO layers for future COGS. That is not payment truth and not settled FX rate.

---

## Future Sales boundary

See `docs/warehouse-sales-contract.md`.

Warehouse owns availability. Sales owns orders. Channels sync from Warehouse availability — never independent stock truth.

---

## Aggregate candidates (not implemented)

| Candidate | Role |
|---|---|
| `Warehouse` | Aggregate root — company-scoped physical site |
| `WarehouseLocation` | Aggregate/entity — flexible hierarchy node under Warehouse |
| `GoodsReceipt` (+ items) | Aggregate — receiving workflow (DRAFT → POSTED) |
| `InventoryBatch` | Entity — physical lot identity (SKU-specific) |
| `InventoryMovement` | **Append-only fact** — canonical stock history |
| `StockBalance` | **Read model / projection** — not freely editable |
| `FifoLayer` | Operational cost provenance state (reconcilable) |
| `StockTransfer` | Aggregate — internal move workflow |
| `StockAdjustment` | Aggregate — explicit correction workflow |
| `StockCount` | Aggregate — count → difference → adjustment movements |
| `InventoryReservation` | Aggregate/entity — commercial hold on sellable stock |

Rationale: treat movements as immutable ledger facts; treat balances/FIFO remaining as projections/operational state that must reconcile to facts.

---

## Inventory movement architecture

```text
                SKU
                 │
                 ▼
        Inventory Movement Ledger
          CANONICAL STOCK HISTORY
                 │
        ┌────────┼─────────┐
        │        │         │
        ▼        ▼         ▼
   Stock      FIFO      Inventory
   Balance    Layers     History UI
```

### Sign convention

```text
positive quantityDelta = stock enters the dimensional key
negative quantityDelta = stock leaves the dimensional key
```

Examples: `RECEIVE +100`, `ISSUE -10`, `ADJUSTMENT_IN +5`, `ADJUSTMENT_OUT -3`.

Transfers use balanced legs (OUT + IN) that conserve company quantity.

### Movement type taxonomy (extensible)

Separate `movementType` from `sourceType` / `reason` — do not create hundreds of types.

| movementType | Conserves company qty? | Notes |
|---|---|---|
| `RECEIVE` | No (increases) | From posted Goods Receipt |
| `ISSUE` | No (decreases) | Manual / ops issue |
| `TRANSFER_OUT` / `TRANSFER_IN` | Yes (pair) | Location or warehouse move |
| `STATE_TRANSFER_OUT` / `STATE_TRANSFER_IN` | Yes (pair) | e.g. SELLABLE → TESTER |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | No | Explicit adjustment workflow |
| `STOCK_COUNT_ADJUSTMENT_*` | No | From completed stock count |
| `SUPPLIER_RETURN_OUT` | No | Physical supplier return |
| `CUSTOMER_RETURN_IN` | No | FUTURE |
| `SALES_FULFILLMENT_OUT` | No | FUTURE |
| `SALES_RETURN_IN` | No | FUTURE |

### Immutability

Posted movements are **never** edited or deleted in normal operations. Corrections use compensating movements (and optional `reversalOfMovementId` linkage later). Double-reversal of the same effect must be prevented.

### Conceptual movement fields (future)

```text
id, companyId, skuId, warehouseId, locationId?, batchId?,
inventoryState, movementType, quantityDelta, occurredAt (server),
sourceType, sourceId, reason, actor, reversalOfMovementId?
```

### No public CRUD

`InventoryMovement` is **not** a public CRUD resource. Trusted workflows create movements:

```text
postGoodsReceipt / completeTransfer / approveAdjustment /
completeStockCount / issueStock / changeStockState / …
```

---

## Stock balance architecture

Stock Balance is a **fast read projection**, not editable truth.

### Conceptual stock key

```text
companyId
warehouseId
locationId?      // nullable early; must support later without redesign
skuId
batchId?         // nullable unless tracking required
inventoryState
```

### Reconstructability (invariant)

```text
Stock Balance = sum of applicable Inventory Movements
```

for the same dimensional key (subject to final null-dimension encoding).

### Null uniqueness

PostgreSQL UNIQUE treats NULL specially. When implementing balances with nullable `locationId` / `batchId`, choose one of:

```text
NULLS NOT DISTINCT
sentinel dimensions
partial unique indexes
normalized stock-key encoding
```

Decision deferred to Stock Balance implementation — must not allow duplicate logical rows.

### Zero rows

Whether to keep or delete zero-balance projection rows is deferred. Movement history remains regardless.

### Quantity type

Integer units (matches Purchasing/Catalog cosmetics domain). Never floating-point.

---

## Inventory state architecture

Initial states:

```text
SELLABLE
TESTER
DAMAGED
QUARANTINE
```

Reserved future candidates: `EXPIRED`, `RETURN_PENDING`, `QUALITY_HOLD`, `IN_TRANSIT` (may also be modeled as location/state hybrid).

**Same SKU, different states** — never duplicate SKU for tester/damaged.

State change is a traceable transfer:

```text
SELLABLE -1
TESTER   +1
```

Net physical quantity unchanged; FIFO/cost provenance preserved.

### Definitions

| Term | Definition |
|---|---|
| `ON_HAND` | Sum of physically present states that count as company presence: SELLABLE + TESTER + DAMAGED + QUARANTINE (+ future physical states) |
| `SELLABLE_ON_HAND` | Quantity in `SELLABLE` only |
| `RESERVED` | Active reservations against sellable (not a physical reduction) |
| `AVAILABLE` | `SELLABLE_ON_HAND − ACTIVE_RESERVATIONS` (− future safety stock) |

---

## Reservation architecture

- Reservation does **not** reduce physical On Hand.
- Warehouse owns reservation against physical availability; Sales owns *why*.
- Commercial reservation grain (recommended): `company + warehouse + sku`.
- Physical pick/allocation may later select `location + batch`.
- Every reservation references `sourceType` / `sourceId` (e.g. `SALES_ORDER`).
- Extension points: safety stock, channel allocation limits — not implemented in 3.1.

---

## Negative stock policy

**Default: physical stock must not become negative.**

Insufficient stock → reject. Future override (if ever) requires explicit permission + reason + audit — not designed as silent behavior.

Concurrency: two simultaneous stock-outs/reservations must not both consume the same units. Implementation must serialize mutations at the relevant stock/reservation key (row lock / atomic conditional update / serializable TX — choose at implementation time against PostgreSQL + Prisma).

---

## Warehouse / location architecture

```text
Company
 └── Warehouse (many allowed; optional default per company)
      └── WarehouseLocation (flexible hierarchy)
```

Hierarchy may be shallow today (`Warehouse → Shelf A`) or deep later (`Zone → Aisle → Rack → Shelf → Bin`). Empty levels are not required.

- Stable DB `id`; human code (e.g. `A-03`) and location barcode are not the primary key.
- Multiple warehouses are mandatory in the model even if Pishteh starts with one.
- Default warehouse may exist but must be **server-resolved**, not silently assumed without policy.
- Deactivation preserves history; no hard-delete when referenced.

`locationId` may be nullable for early warehouse-level stock; later location tracking must not redesign movement identity.

---

## Batch / lot architecture

- Batch is Warehouse-owned, **SKU-specific**.
- Supplier batch text is **not** globally unique; uniqueness context is at least `(company, sku, supplierBatchNumber)` (exact unique rule finalized at schema time).
- `expiryDate` nullable — not required for Pishteh receiving.
- One PO item may receive **multiple batches**.
- Same supplier batch may arrive across multiple receipts without duplicate lot identity when scoped correctly.
- `batchId` nullable when tracking not required.
- Future SKU policy extension (not Catalog schema now): `batchTrackingRequired` / `expiryTrackingRequired` / `locationTrackingRequired`.
- Serial numbers: out of scope; architecture must not make them impossible later.

**Batch ≠ FIFO layer.** One batch may have multiple acquisition layers.

---

## Goods receipt architecture

Conceptual lifecycle:

```text
DRAFT → POSTED
DRAFT | POSTED → CANCELLED / REVERSED (via compensating mechanism)
```

- **DRAFT** does not affect stock.
- **POSTED** affects stock exactly once (movements + balance projection + FIFO layer origin).
- Posted receipt quantities are not silently edited; use reversal / correction movements / replacement receipt.
- Posting transaction boundary (future): receipt status + items + movements + balance projection + FIFO layers atomically.
- Partial and multiple receipts are first-class.
- Wrong PO SKU on scan → reject / explicit discrepancy — never silently add SKU to PO.

### Over-receipt (Phase 3.1 decision)

```text
Default: over-receipt NOT allowed.
acceptedReceived ≤ ordered (per PO line)
```

Future override (permission + reason + audit) may be added later; not in early receiving.

Short receipt is valid and does **not** alone commercially close the PO — Purchasing short-close / correction owns commercial closure.

---

## Transfer / adjustment / stock count

### Transfer

Workflow aggregate (not direct UI movement creation). Potential lifecycle: `DRAFT → IN_TRANSIT → COMPLETED | CANCELLED`.  
In-transit stock must remain visible (`IN_TRANSIT` state and/or dedicated location). Net company quantity conserved.

### Adjustment

Explicit workflow with reason, actor, audit (approval optional later). Never direct balance patch.

### Stock count

```text
System qty vs Counted qty → Difference → STOCK_COUNT_ADJUSTMENT_* movements on completion
```

Difference is not truth until completed/approved. Concurrent movement during count is an open implementation question (snapshot / location lock / freeze / post-snapshot reconciliation).

---

## FIFO / valuation architecture

- FIFO layers belong to Warehouse/Inventory.
- Natural origin: posted receipt item.
- Conceptual layer: SKU, warehouse, batch?, source receipt item, original/remaining qty, unit acquisition cost, currency/valuation context.
- Remaining quantity never negative; must reconcile to eligible physical quantity under valuation policy.
- State / location / warehouse transfers preserve cost provenance — do not invent a new arbitrary layer for TESTER/DAMAGED/QUARANTINE.
- FX: preserve Purchasing reference/obligation cost basis; **actual FX settlement difference is Finance/Profit**, not Warehouse.
- Purchase cost allocation (courier/shipping/fees) is an open policy question (by qty / value / weight / manual) — leave room; do not invent accounting policy in 3.1.
- Future Profit Engine consumes FIFO consumption linkage (`InventoryConsumption` or equivalent) — not implemented now.

---

## Scanner architecture

Phase **3.6** implements keyboard-wedge receiving against DRAFT GRNs
(`docs/barcode-scanner-receiving.md`):

- Prefer keyboard-wedge scanners (typed input + Enter); no proprietary SDK required.
- Exact Catalog barcode resolve; string identity; leading zeros preserved.
- Support both: scan-each-unit and scan-once + enter quantity.
- Bounded `requestId` idempotency on `scan/apply` (company + GRN scoped).
- Camera / industrial handheld clients may reuse the same resolve/apply contract later.
- Location barcode scanning / putaway scanning are **not** in 3.6.

---

## Audit vs ledger vs events

| Concern | Role |
|---|---|
| Phase 0 **Audit** | Who changed business data |
| **Inventory Movement** | What physically changed stock (persistent accounting fact) |
| **Domain Event** | Notification that a business event occurred |
| **FIFO Layer** | Remaining cost/receipt consumption structure |
| **Stock Balance** | Fast current-state projection |

- Never rebuild stock from ephemeral domain events.
- Never treat Audit as inventory ledger.
- Use existing Phase 0 Audit; do not create a parallel warehouse audit DB.

### Candidate Warehouse events (not implemented)

```text
GoodsReceiptPosted
StockReceived
StockMoved
StockStateChanged
StockAdjusted
StockCountCompleted
StockIssued
SupplierReturnDispatched
InventoryAvailabilityChanged   ← high-volume; design carefully later
```

Emit meaningful business events — not one event per internal row.

### Event reliability (current infrastructure)

```text
In-process: YES
Durable: NO
Transactional Outbox: NO
Crash-safe after commit: NO
```

Warehouse correctness must not assume guaranteed delivery. Future outbox remains an architectural improvement for Sales/channel sync.

---

## Concurrency / idempotency / reversal

| Risk | Later prevention (not claimed implemented) |
|---|---|
| Concurrent issue oversell | Atomic stock key update / row lock / conditional qty check |
| Concurrent reservation oversubscribe | Same against reservation+sellable key |
| Double post receipt | Idempotency key + receipt status machine |
| Double complete transfer/adjustment/count | Status machine + idempotency |
| Double reversal | Linkage + “already reversed” guard |

Server timestamps for stock facts. Client `occurredAt` is not trusted for posting. Optional later `businessDate` vs `postedAt`.

---

## Multi-tenant strategy

Every Warehouse-owned entity is `companyId`-scoped. Company A must never affect Company B inventory. Prefer composite FK patterns where practical (as Purchasing/Catalog already do); evaluate Prisma complexity per table — do not blindly add every composite FK in one step.

---

## API boundary (future)

Expose business operations, not generic inventory CRUD:

```text
post receipt · move stock · create/complete transfer · issue stock ·
change state · create/approve adjustment · complete stock count ·
reserve / release reservation
```

Forbidden as public resources: direct Movement create, StockBalance patch, FifoLayer edit.

### Permissions

**Implemented (3.2–3.4):**

```text
warehouse.read / warehouse.manage
warehouse.receipt.read / warehouse.receipt.manage / warehouse.receipt.post
```

**Candidates (later):**

```text
warehouse.stock.read
warehouse.transfer.create|complete
warehouse.issue.create
warehouse.adjustment.create|approve
warehouse.count.create|complete
warehouse.audit.read
```

Scanning is not authorization. Separation of duties (create vs approve adjustment) is an extension point.

Goods Receipt Core (Phase 3.4) is documented in `docs/goods-receipts.md`.

---

## Reconciliation strategy (future)

```text
L1  Movements ↔ Stock Balance
L2  Eligible physical stock ↔ FIFO remaining
L3  Goods Receipts ↔ RECEIVE movements
L4  Transfers ↔ balanced legs
L5  Reservations ≤ sellable policy
```

Read-only gate (master + locations + GRN + batch allocations + putaway): `pnpm db:check:warehouse`.

---

## Operational simplicity vs scale

Pishteh today: one small warehouse, basic shelves, existing SKU barcodes, simple receive → shelf workflow.

Architecture must allow that simple path **and** later multi-warehouse, multi-worker, multi-channel, high volume without redesigning ledger identity.

---

## Phase 3.1 non-goals

Do **not** create in 3.1:

```text
warehouses, locations, goods_receipts, batches, movements,
stock_balances, reservations, fifo_layers, transfers, counts
Warehouse API / UI / scanner flows
Sales / Finance / Profit operational modules
```

---

## Open architecture questions (non-blocking)

1. Exact null-dimension uniqueness encoding for StockBalance.
2. Whether `IN_TRANSIT` is inventory state, special location, or both.
3. Purchase cost allocation method into FIFO unit cost.
4. Stock-count concurrency / freeze strategy.
5. Whether commercial reservations ever pin batch/location by default.
6. High-volume `InventoryAvailabilityChanged` fan-out design.
7. When (if ever) over-receipt override permission ships.

These do not block Warehouse Master (3.2).
